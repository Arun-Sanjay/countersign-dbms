// =====================================================================
//  Countersign · rebuild elp.portfolios from the evidence (aggregation ending in $merge).
//
//  Run:  npx -y mongosh@latest "$MONGODB_URI" --quiet < mongo/portfolio_merge.js
//        (target db: 'elp', or define ELP_DB first, as for validators.js)
//
//  Sources, all streamed into ONE pipeline with $unionWith:
//    notes               -> notes authored / final, teams, last note date
//    note_versions       -> versions authored (the immutable receipts)
//    github_events       -> commits and lines added per author ($unwind of the push)
//    portfolios          -> the students already known (so every one is re-stamped)
//    pg_portfolio_export -> OPTIONAL relational facts exported from Postgres (name, semester,
//                           projects, claim counts; never marks). Filled by
//                           `cd api && uv run python -m app.export_pg`. If the collection
//                           does not exist, $unionWith simply contributes nothing.
//  Output: one document per student, keyed by usn, stamped with generated_at = $$NOW.
//  $merge keeps the existing name / projects (fixture M3 data) unless the export has newer
//  ones, so M12/M22/M23-style queries keep working on the merged documents.
// =====================================================================

(function () {
  const target = db.getSiblingDB(typeof ELP_DB === 'string' ? ELP_DB : 'elp');
  // $merge on: 'usn' needs a unique index on portfolios.usn (also created by validators.js;
  // repeated here because mongo/seed.js drops the collection and its indexes).
  target.portfolios.createIndex({ usn: 1 }, { unique: true, name: 'usn_unique' });

  const pipeline = [
    // ---- 1. notes: one row per note, by author ----
    { $project: { _id: 0, usn: '$author_usn', kind: 'note', team_id: 1,
                  final: { $eq: ['$status', 'final'] },
                  at: { $ifNull: ['$updated_at', '$created_at'] } } },

    // ---- 2. note versions: one row per immutable version, by the author of that version ----
    { $unionWith: { coll: 'note_versions', pipeline: [
        { $project: { _id: 0, usn: '$author_usn', kind: 'version', at: '$created_at' } } ] } },

    // ---- 3. commits: unwind each push into its commits ----
    { $unionWith: { coll: 'github_events', pipeline: [
        { $unwind: '$commits' },
        { $project: { _id: 0, usn: '$commits.author_usn', kind: 'commit', team_id: 1, repo: 1,
                      additions: { $ifNull: ['$commits.additions', 0] }, at: '$pushed_at' } } ] } },

    // ---- 4. optional Postgres export (relational facts) ----
    { $unionWith: { coll: 'pg_portfolio_export', pipeline: [
        { $project: { _id: 0, usn: 1, kind: 'pg', name: 1, semester: 1, projects: 1,
                      claims: 1 } } ] } },

    // ---- 5. every student who already has a portfolio, so nobody is skipped: a student
    //         with no rows above still gets a stamped "no recorded evidence yet" ----
    { $unionWith: { coll: 'portfolios', pipeline: [
        { $project: { _id: 0, usn: 1, kind: 'known' } } ] } },

    { $match: { usn: { $type: 'string' } } },

    // ---- 6. one group per student ----
    { $group: {
        _id: '$usn',
        notes:        { $sum: { $cond: [{ $eq: ['$kind', 'note'] }, 1, 0] } },
        final_notes:  { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'note'] }, '$final'] }, 1, 0] } },
        versions:     { $sum: { $cond: [{ $eq: ['$kind', 'version'] }, 1, 0] } },
        commits:      { $sum: { $cond: [{ $eq: ['$kind', 'commit'] }, 1, 0] } },
        lines_added:  { $sum: { $cond: [{ $eq: ['$kind', 'commit'] }, '$additions', 0] } },
        note_teams:   { $addToSet: { $cond: [{ $eq: ['$kind', 'note'] }, '$team_id', '$$REMOVE'] } },
        commit_teams: { $addToSet: { $cond: [{ $eq: ['$kind', 'commit'] }, '$team_id', '$$REMOVE'] } },
        repos:        { $addToSet: { $cond: [{ $eq: ['$kind', 'commit'] }, '$repo', '$$REMOVE'] } },
        last_note_at:   { $max: { $cond: [{ $eq: ['$kind', 'note'] }, '$at', null] } },
        last_commit_at: { $max: { $cond: [{ $eq: ['$kind', 'commit'] }, '$at', null] } },
        pg:           { $max: { $cond: [{ $eq: ['$kind', 'pg'] },
                                        { name: '$name', semester: '$semester', projects: '$projects',
                                          claims: '$claims' },
                                        null] } }
    } },

    // ---- 7. portfolio shape (validator: usn + projects required) ----
    { $project: {
        _id: 0,
        usn: '$_id',
        name: '$pg.name',                                   // missing => keep the stored name
        semester: '$pg.semester',
        projects: { $ifNull: ['$pg.projects', []] },
        evidence: {
          notes:         { authored: '$notes', final: '$final_notes', last_at: '$last_note_at',
                           teams: { $sortArray: { input: '$note_teams', sortBy: 1 } } },
          note_versions: { authored: '$versions' },
          commits:       { count: '$commits', lines_added: '$lines_added', last_at: '$last_commit_at',
                           teams: { $sortArray: { input: '$commit_teams', sortBy: 1 } },
                           repos: { $sortArray: { input: '$repos', sortBy: 1 } } },
          claims:  { $ifNull: ['$pg.claims', null] },        // pending / confirmed / contested
          // wording rule: an empty record is "no recorded evidence yet", never a verdict
          summary: { $cond: [{ $eq: [{ $add: ['$notes', '$commits', '$versions',
                                               { $ifNull: ['$pg.claims.pending', 0] },
                                               { $ifNull: ['$pg.claims.confirmed', 0] },
                                               { $ifNull: ['$pg.claims.contested', 0] }] }, 0] },
                             'no recorded evidence yet', 'has recorded evidence'] }
        },
        generated_at: '$$NOW'
    } },

    // ---- 8. upsert into portfolios ----
    { $merge: {
        into: 'portfolios',
        on: 'usn',
        whenMatched: [
          { $set: {
              evidence: '$$new.evidence',
              generated_at: '$$new.generated_at',
              // export value, else the stored one, else leave the field out (never null)
              name: { $ifNull: ['$$new.name', '$name', '$$REMOVE'] },
              semester: { $ifNull: ['$$new.semester', '$semester', '$$REMOVE'] },
              projects: { $cond: [{ $gt: [{ $size: '$$new.projects' }, 0] }, '$$new.projects',
                                  { $ifNull: ['$projects', []] }] }
          } }
        ],
        whenNotMatched: 'insert'
    } }
  ];

  target.notes.aggregate(pipeline).toArray();

  const total = target.portfolios.countDocuments();
  const stamped = target.portfolios.countDocuments({ generated_at: { $type: 'date' } });
  const sample = target.portfolios.find({ usn: '1RV24CY047' },
    { _id: 0, usn: 1, name: 1, 'evidence.notes.authored': 1, 'evidence.commits.count': 1, generated_at: 1 }).toArray();
  print(JSON.stringify({ db: target.getName(), portfolios: total, stamped: stamped, sample: sample }));
})();

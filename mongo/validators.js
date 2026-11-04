// =====================================================================
//  Countersign · MongoDB schema validators, indexes and note history.
//
//  Run (idempotent; safe to re-run after mongo/seed.js, which drops the collections):
//    npx -y mongosh@latest "$MONGODB_URI" --quiet < mongo/validators.js
//  Target database: 'elp' unless the variable ELP_DB is defined first, e.g.
//    { echo 'var ELP_DB = "elp_validator_check";'; cat mongo/validators.js; } | mongosh "$URI" --quiet
//
//  What it does, per collection:
//    1. creates it (or collMods it) with a $jsonSchema validator,
//       validationLevel "strict" + validationAction "error";
//    2. reports how many EXISTING documents would fail the validator (must be 0);
//    3. creates the indexes the API and the portfolio $merge rely on.
//  Then it backfills note_versions: one immutable snapshot per existing note.
//
//  The validators must accept every document shape the frozen fixture (mongo/04_mongo.js)
//  writes: M1 notes (some have no `links`), M2 push events, M3 portfolios (Nikhil: projects []),
//  and the M15/M16 updates ($set status, $inc version, $push / $pull tags).
//  Numbers: mongosh stores integral JS numbers as int32 and others as double, Python as
//  int32/int64, so every numeric field accepts int | long | double.
// =====================================================================

(function () {
  const target = db.getSiblingDB(typeof ELP_DB === 'string' ? ELP_DB : 'elp');
  const crypto = require('crypto');
  const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const NUM = ['int', 'long', 'double'];
  const USN = '^1RV[0-9]{2}[A-Z]{2}[0-9]{3}$';      // e.g. 1RV24CY047 (student.usn)
  const TEAM = '^T[0-9]{2,3}$';                      // e.g. T00 .. T06 (team.team_id)
  const strArray = { bsonType: 'array', items: { bsonType: 'string' } };

  const schemas = {
    // ---- notes: the current state of an Obsidian / editor note (M1 shape + app fields) ----
    notes: {
      bsonType: 'object',
      required: ['note_id', 'team_id', 'author_usn', 'title'],
      properties: {
        note_id:       { bsonType: 'string', minLength: 1, maxLength: 40 },
        team_id:       { bsonType: 'string', pattern: TEAM },
        author_usn:    { bsonType: 'string', pattern: USN },
        title:         { bsonType: 'string', minLength: 1, maxLength: 200 },
        tags:          strArray,
        links:         strArray,
        status:        { enum: ['draft', 'final'] },
        version:       { bsonType: NUM, minimum: 1 },
        content:       { bsonType: 'string' },
        created_at:    { bsonType: 'date' },
        updated_at:    { bsonType: 'date' },
        // app fields (PLAN §4): Postgres link + the three privacy tiers
        artifact_id:   { bsonType: ['string', 'null'] },
        visibility:    { enum: ['private', 'team', 'submitted'] },
        ai_assistance: { enum: ['none', 'assisted', 'generated'] },
        updated_by:    { bsonType: 'string', pattern: USN }
      }
    },

    // ---- note_versions: immutable history; _id = "<note_id>:<version>" ----
    // Append-only: the API only ever inserts, and the _id makes a version number single-use.
    note_versions: {
      bsonType: 'object',
      required: ['_id', 'note_id', 'version', 'author_usn', 'content', 'created_at'],
      properties: {
        _id:           { bsonType: 'string', pattern: '^.+:[0-9]+$' },
        note_id:       { bsonType: 'string', minLength: 1, maxLength: 40 },
        version:       { bsonType: NUM, minimum: 1 },
        team_id:       { bsonType: 'string', pattern: TEAM },
        author_usn:    { bsonType: 'string', pattern: USN },
        title:         { bsonType: 'string', maxLength: 200 },
        content:       { bsonType: 'string' },
        content_hash:  { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },   // sha256 hex, as in Postgres
        status:        { enum: ['draft', 'final'] },
        tags:          strArray,
        ai_assistance: { enum: ['none', 'assisted', 'generated'] },
        backfilled:    { bsonType: 'bool' },
        created_at:    { bsonType: 'date' }
      }
    },

    // ---- github_events: one raw push per document, commits embedded (M2 shape) ----
    github_events: {
      bsonType: 'object',
      required: ['event_id', 'team_id', 'type', 'commits'],
      properties: {
        event_id:    { bsonType: 'string', minLength: 1 },
        delivery_id: { bsonType: 'string' },                // X-GitHub-Delivery, when ingested
        college_id:  { bsonType: 'string' },
        team_id:     { bsonType: 'string', pattern: TEAM },
        repo:        { bsonType: 'string' },
        type:        { enum: ['push'] },
        pushed_at:   { bsonType: 'date' },
        commits: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['sha', 'author_usn'],
            properties: {
              sha:           { bsonType: 'string', pattern: '^[0-9a-f]{4,40}$' },
              author_usn:    { bsonType: 'string', pattern: USN },
              message:       { bsonType: 'string' },
              files_changed: { bsonType: NUM, minimum: 0 },
              additions:     { bsonType: NUM, minimum: 0 },
              deletions:     { bsonType: NUM, minimum: 0 }
            }
          }
        }
      }
    },

    // ---- portfolios: one aggregate per student (M3 shape) + the $merge output ----
    portfolios: {
      bsonType: 'object',
      required: ['usn', 'projects'],
      properties: {
        usn:      { bsonType: 'string', pattern: USN },
        name:     { bsonType: 'string' },
        semester: { bsonType: NUM, minimum: 1, maximum: 8 },
        projects: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['course', 'title'],
            properties: {
              course: { bsonType: 'string' },
              title:  { bsonType: 'string' },
              role:   { enum: ['lead', 'member'] },
              status: { bsonType: 'string' },
              skills: strArray
            }
          }
        },
        evidence:     { bsonType: 'object' },
        generated_at: { bsonType: 'date' }
      }
    }
  };

  const existing = target.getCollectionNames();
  const report = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const options = { validator: { $jsonSchema: schema }, validationLevel: 'strict', validationAction: 'error' };
    if (existing.includes(name)) {
      target.runCommand(Object.assign({ collMod: name }, options));
    } else {
      target.createCollection(name, options);
    }
    report[name] = {
      docs: target.getCollection(name).countDocuments(),
      // documents already stored that the new validator would reject (must be 0)
      invalid: target.getCollection(name).countDocuments({ $nor: [{ $jsonSchema: schema }] })
    };
  }

  // ---- indexes ----
  target.notes.createIndex({ note_id: 1 }, { unique: true, name: 'note_id_unique' });
  target.notes.createIndex({ team_id: 1, created_at: -1 });            // same spec as fixture M24
  target.note_versions.createIndex({ note_id: 1, version: -1 }, { unique: true, name: 'note_version_desc' });
  target.github_events.createIndex({ event_id: 1 }, { unique: true, name: 'event_id_unique' });
  target.github_events.createIndex({ team_id: 1, pushed_at: -1 });
  target.github_events.createIndex({ 'commits.author_usn': 1 });
  target.portfolios.createIndex({ usn: 1 }, { unique: true, name: 'usn_unique' });   // $merge on: 'usn'

  // ---- backfill: snapshot each note's current state as its first recorded version ----
  // History capture starts now, so the snapshot keeps the note's CURRENT version number
  // (N01 is at version 3: its snapshot is N01:3, the next save is N01:4). Earlier versions
  // were never captured and are not invented. Re-running inserts nothing new ($setOnInsert).
  let backfilled = 0;
  target.notes.find().forEach(function (n) {
    const v = n.version || 1;
    const content = n.content || '';
    const doc = {
      note_id: n.note_id, version: v, team_id: n.team_id, author_usn: n.author_usn,
      title: n.title, content: content, content_hash: sha256(content), status: n.status || 'draft',
      tags: n.tags || [], backfilled: true,
      created_at: n.updated_at || n.created_at || new Date()
    };
    const r = target.note_versions.updateOne({ _id: n.note_id + ':' + v }, { $setOnInsert: doc }, { upsert: true });
    if (r.upsertedCount) backfilled += 1;
  });

  print(JSON.stringify({
    db: target.getName(),
    collections: report,
    note_versions_backfilled: backfilled,
    note_versions: target.note_versions.countDocuments()
  }));
})();

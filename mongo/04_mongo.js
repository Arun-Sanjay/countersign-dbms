// =====================================================================
//  Unified Experiential Learning Platform : NoSQL TEST QUERIES (Unit V)
//  MongoDB 8 / mongosh. Run:  mongosh < 04_mongo.js   (or paste query by query)
//  Collections:
//    notes          - Obsidian research notes (markdown + frontmatter)
//    github_events  - raw GitHub push events (one document per push)
//    portfolios     - one aggregate document per student (all projects)
// =====================================================================

use elp

db.notes.drop()
db.github_events.drop()
db.portfolios.drop()

// M1. Insert Obsidian notes for the teams (insertMany).
db.notes.insertMany([
  { note_id: "N01", team_id: "T01", author_usn: "1RV24CY047", title: "Synopsis outline",
    tags: ["synopsis", "planning"], links: ["Literature survey"], status: "final", version: 3,
    content: "Problem statement and proposed system for the unified EL platform.",
    created_at: ISODate("2026-10-09") },
  { note_id: "N02", team_id: "T01", author_usn: "1RV24CY011", title: "Literature survey",
    tags: ["research", "provenance"], links: ["Synopsis outline"], status: "final", version: 2,
    content: "Data provenance research tracks who changed each record and when.",
    created_at: ISODate("2026-10-07") },
  { note_id: "N03", team_id: "T01", author_usn: "1RV24CY024", title: "ER diagram decisions",
    tags: ["er-diagram", "design", "todo"], links: ["Normalization plan"], status: "draft", version: 1,
    content: "MILESTONE is a weak entity of PROJECT. TEAM_MEMBER resolves M:N.",
    created_at: ISODate("2026-10-29") },
  { note_id: "N04", team_id: "T01", author_usn: "1RV24CY047", title: "Normalization plan",
    tags: ["normalization", "design"], status: "draft", version: 1,
    content: "Start from the paper marks sheet and normalize up to BCNF.",
    created_at: ISODate("2026-11-02") },
  { note_id: "N05", team_id: "T02", author_usn: "1RV24CY041", title: "Requirements notes",
    tags: ["requirements", "todo"], links: [], status: "final", version: 2,
    content: "Functional and non functional requirements gathered from faculty.",
    created_at: ISODate("2026-10-24") },
  { note_id: "N06", team_id: "T02", author_usn: "1RV24CY052", title: "Synopsis review",
    tags: ["synopsis", "review"], status: "draft", version: 1,
    content: "Comments on the synopsis draft.",
    created_at: ISODate("2026-10-15") },
  { note_id: "N07", team_id: "T03", author_usn: "1RV24CY063", title: "Model baseline",
    tags: ["ml", "research"], links: ["Dataset survey"], status: "final", version: 4,
    content: "Baseline model and evaluation metrics.",
    created_at: ISODate("2026-10-20") }
])

// M2. Insert raw GitHub push events (embedded array of commits).
db.github_events.insertMany([
  { event_id: "E01", team_id: "T01", repo: "rvce-el/team-alpha", type: "push", pushed_at: ISODate("2026-10-31"),
    commits: [ { sha: "a1f3", author_usn: "1RV24CY047", message: "Add CREATE TABLE scripts", files_changed: 4, additions: 210 },
               { sha: "b7c2", author_usn: "1RV24CY024", message: "Add foreign keys",          files_changed: 2, additions: 45 } ] },
  { event_id: "E02", team_id: "T01", repo: "rvce-el/team-alpha", type: "push", pushed_at: ISODate("2026-11-01"),
    commits: [ { sha: "c9d1", author_usn: "1RV24CY024", message: "Add CHECK constraints",     files_changed: 1, additions: 30 },
               { sha: "d4e8", author_usn: "1RV24CY047", message: "Seed sample data",          files_changed: 2, additions: 160 },
               { sha: "e2a9", author_usn: "1RV24CY011", message: "Update ER diagram notes",   files_changed: 1, additions: 25 } ] },
  { event_id: "E03", team_id: "T03", repo: "rvce-el/team-gamma", type: "push", pushed_at: ISODate("2026-11-02"),
    commits: [ { sha: "f1b4", author_usn: "1RV24CY063", message: "Data loader",               files_changed: 3, additions: 120 },
               { sha: "a8c3", author_usn: "1RV24CY066", message: "Training loop",             files_changed: 2, additions: 95 } ] }
])

// M3. Insert one aggregate portfolio document per student (embedded projects + skills).
db.portfolios.insertMany([
  { usn: "1RV24CY047", name: "S Arun Sanjay", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project",          role: "lead",   status: "active",    skills: ["SQL", "MongoDB", "Python"] },
                { course: "CD253IA", title: "AIML Experiential Learning", role: "member", status: "active",    skills: ["Python", "Machine Learning"] },
                { course: "CD243AI", title: "ADLD Hardware Project",      role: "lead",   status: "completed", skills: ["Digital Logic"] } ] },
  { usn: "1RV24CY011", name: "Aditi Rao", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project",     role: "member", status: "active",    skills: ["SQL", "Normalization"] },
                { course: "CD243AI", title: "ADLD Hardware Project", role: "member", status: "completed", skills: ["Digital Logic"] } ] },
  { usn: "1RV24CY024", name: "Karthik M", semester: 5,
    projects: [ { course: "CD252IA", title: "DBMS Mini Project", role: "member", status: "active", skills: ["SQL"] },
                { course: "CD254TA", title: "OS Mini Project",   role: "lead",   status: "active", skills: ["Operating Systems", "Python"] } ] },
  { usn: "1RV24CY063", name: "Priya Menon", semester: 5,
    projects: [ { course: "CD253IA", title: "AIML Experiential Learning", role: "lead", status: "active", skills: ["Python", "Machine Learning", "Deep Learning"] } ] },
  { usn: "1RV24CY077", name: "Nikhil Bhat", semester: 5, projects: [] }
])

// ===================== A. FIND, OPERATORS, PROJECTION =====================

// M4. Find all notes written by S Arun Sanjay.
db.notes.find({ author_usn: "1RV24CY047" }, { _id: 0, title: 1, status: 1 })

// M5. Find notes tagged "design" (matching a value inside an array).
db.notes.find({ tags: "design" }, { _id: 0, title: 1, tags: 1 })

// M6. Show the 3 most recent notes: title and date only, newest first.
db.notes.find({}, { _id: 0, title: 1, created_at: 1 }).sort({ created_at: -1 }).limit(3)

// M7. Final notes of Team Alpha (T01) created after 1 Oct 2026 ($and, $gt).
db.notes.find({ $and: [ { team_id: "T01" }, { status: "final" }, { created_at: { $gt: ISODate("2026-10-01") } } ] },
              { _id: 0, title: 1, created_at: 1 })

// M8. Notes whose title contains "synopsis", ignoring case ($regex).
db.notes.find({ title: { $regex: "synopsis", $options: "i" } }, { _id: 0, team_id: 1, title: 1 })

// M9. Notes that are either tagged "normalization" or written by Karthik M ($or).
db.notes.find({ $or: [ { tags: "normalization" }, { author_usn: "1RV24CY024" } ] }, { _id: 0, title: 1, author_usn: 1 })

// M10. Notes with version 2 or more that belong to Team Alpha or Team Gamma ($gte, $in).
db.notes.find({ version: { $gte: 2 }, team_id: { $in: ["T01", "T03"] } }, { _id: 0, team_id: 1, title: 1, version: 1 })

// M11. Notes that have no "links" field at all ($exists).
db.notes.find({ links: { $exists: false } }, { _id: 0, title: 1 })

// M12. Portfolios of students who worked on a DBMS (CD252IA) project (dot notation into an array).
db.portfolios.find({ "projects.course": "CD252IA" }, { _id: 0, usn: 1, name: 1 })

// M13. Push events containing a commit by Arun that changed 3 or more files ($elemMatch).
db.github_events.find({ commits: { $elemMatch: { author_usn: "1RV24CY047", files_changed: { $gte: 3 } } } },
                      { _id: 0, event_id: 1, repo: 1 })

// M14. Count the notes of Team Alpha, and list the distinct tags used anywhere.
db.notes.countDocuments({ team_id: "T01" })
db.notes.distinct("tags")

// ===================== B. UPDATE AND DELETE =====================

// M15. Finalise the ER diagram note: set status, increase version, add a tag ($set, $inc, $push).
db.notes.updateOne({ note_id: "N03" }, { $set: { status: "final" }, $inc: { version: 1 }, $push: { tags: "reviewed" } })
db.notes.find({ note_id: "N03" }, { _id: 0, title: 1, status: 1, version: 1, tags: 1 })

// M16. Remove the "todo" tag from every note ($pull with updateMany).
db.notes.updateMany({ tags: "todo" }, { $pull: { tags: "todo" } })

// M17. Delete all draft notes of Team Beta (T02).
db.notes.deleteMany({ team_id: "T02", status: "draft" })
db.notes.countDocuments()

// ===================== C. AGGREGATION PIPELINE =====================

// M18. Total commits and lines added by each student across all pushes ($unwind, $group, $sort).
db.github_events.aggregate([
  { $unwind: "$commits" },
  { $group: { _id: "$commits.author_usn", commits: { $sum: 1 }, lines_added: { $sum: "$commits.additions" } } },
  { $sort: { lines_added: -1 } }
])

// M19. Number of notes and average version per team ($group, $avg, $round).
db.notes.aggregate([
  { $group: { _id: "$team_id", notes: { $sum: 1 }, avg_version: { $avg: "$version" } } },
  { $project: { notes: 1, avg_version: { $round: ["$avg_version", 1] } } },
  { $sort: { _id: 1 } }
])

// M20. Top 3 most used tags across all notes.
db.notes.aggregate([
  { $unwind: "$tags" },
  { $group: { _id: "$tags", uses: { $sum: 1 } } },
  { $sort: { uses: -1, _id: 1 } },
  { $limit: 3 }
])

// M21. Show each final note with its author's name, joined from portfolios ($lookup).
db.notes.aggregate([
  { $match: { status: "final" } },
  { $lookup: { from: "portfolios", localField: "author_usn", foreignField: "usn", as: "author" } },
  { $unwind: "$author" },
  { $project: { _id: 0, title: 1, author: "$author.name" } }
])

// M22. Skill frequency across all student portfolios (double $unwind), for cohort skill analytics.
db.portfolios.aggregate([
  { $unwind: "$projects" },
  { $unwind: "$projects.skills" },
  { $group: { _id: "$projects.skills", students: { $addToSet: "$usn" } } },
  { $project: { skill: "$_id", _id: 0, students: { $size: "$students" } } },
  { $sort: { students: -1, skill: 1 } }
])

// M23. Number of projects per student, including students with none ($size).
db.portfolios.aggregate([
  { $project: { _id: 0, name: 1, project_count: { $size: "$projects" } } },
  { $sort: { project_count: -1 } }
])

// ===================== D. INDEXES =====================

// M24. Create a compound index for "notes of a team, newest first", and a text index for search.
db.notes.createIndex({ team_id: 1, created_at: -1 })
db.notes.createIndex({ title: "text", content: "text" })

// M25. Full-text search for notes about "provenance" using the text index.
db.notes.find({ $text: { $search: "provenance" } }, { _id: 0, title: 1 })

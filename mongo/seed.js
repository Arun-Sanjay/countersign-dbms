// Seed for the elp database (data block + indexes of mongo/04_mongo.js, Appendix E). Idempotent: drops and reloads.
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

// ===================== D. INDEXES =====================

// M24. Create a compound index for "notes of a team, newest first", and a text index for search.
db.notes.createIndex({ team_id: 1, created_at: -1 })
db.notes.createIndex({ title: "text", content: "text" })

// M25. Full-text search for notes about "provenance" using the text index.
db.notes.find({ $text: { $search: "provenance" } }, { _id: 0, title: 1 })
print(JSON.stringify({notes: db.notes.countDocuments(), github_events: db.github_events.countDocuments(), portfolios: db.portfolios.countDocuments(), notes_indexes: db.notes.getIndexes().length}))

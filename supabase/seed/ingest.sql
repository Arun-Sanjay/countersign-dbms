-- =====================================================================
--  Ingestion seed (runs AFTER ./fixture/02_seed.sql and ./seed/demo.sql).
--  Identities and repositories for the GitHub webhook pipeline (migration 0005).
--  Idempotent (ON CONFLICT DO NOTHING), so it can also be run once against the cloud project.
--
--  Real:        Arun-Sanjay (GitHub user 228202223) -> 1RV24CY047;
--               repository Arun-Sanjay/countersign-dbms -> team T00.
--  Placeholder: sanvid-razdan -> 1RV24CY051 (replace with Sanvid's real login once known).
--  Fictional:   the fixture students' logins and the fixture teams' repositories
--               rvce-el/team-alpha (T01) and rvce-el/team-gamma (T03), the same repo names
--               as Mongo elp.github_events (M2), used by the synthetic replay fixtures.
-- =====================================================================

-- verified_at: crediting requires a VERIFIED identity for the pusher (payload.sender; see
-- private.ingest_actor). Arun's is real. The fictional students' logins and numeric ids
-- (7700xx, the USN suffix) are the ones the synthetic replay fixtures use, stamped as
-- admin-verified for the demo. Sanvid's login is a placeholder, so it stays UNVERIFIED and a
-- push sent as 'sanvid-razdan' is logged but credits nobody.
INSERT INTO student_identity (provider, provider_login, provider_user_id, usn, verified_at) VALUES
('github', 'arun-sanjay',     228202223, '1RV24CY047', '2026-11-05 09:00+05:30'),
('github', 'sanvid-razdan',   NULL,      '1RV24CY051', NULL),
('github', 'aditi-rao',       770011,    '1RV24CY011', '2026-11-05 09:00+05:30'),
('github', 'karthik-m',       770024,    '1RV24CY024', '2026-11-05 09:00+05:30'),
('github', 'meera-iyer',      770033,    '1RV24CY033', '2026-11-05 09:00+05:30'),
('github', 'rahul-nair',      770041,    '1RV24CY041', '2026-11-05 09:00+05:30'),
('github', 'sneha-patil',     770052,    '1RV24CY052', '2026-11-05 09:00+05:30'),
('github', 'vikram-shetty',   770058,    '1RV24CY058', '2026-11-05 09:00+05:30'),
('github', 'priya-menon',     770063,    '1RV24CY063', '2026-11-05 09:00+05:30'),
('github', 'rohan-kulkarni',  770066,    '1RV24CY066', '2026-11-05 09:00+05:30'),
('github', 'divya-hegde',     770071,    '1RV24CY071', '2026-11-05 09:00+05:30'),
('github', 'nikhil-bhat',     770077,    '1RV24CY077', '2026-11-05 09:00+05:30'),
('github', 'ananya-gowda',    770082,    '1RV24CY082', '2026-11-05 09:00+05:30'),
-- a commit made without a GitHub-linked e-mail is matched by its author e-mail instead
-- (still credited only when that student is also the verified pusher)
('email',  'aditi.cy24@rvce.edu.in', NULL, '1RV24CY011', NULL)
ON CONFLICT (provider, provider_login) DO NOTHING;

-- default_milestone_no: T00's code is lab component C9 (Demo and Draft Report); the fixture
-- teams use the rule "next open milestone by deadline" (NULL), see private.ingest_milestone.
-- track_paths: T00 is this repository; only the deliverables become artifacts (docs, the
-- vault, the database code), not the web/ and api/ source trees.
INSERT INTO team_repo (repo_full_name, team_id, purpose, default_milestone_no, track_paths) VALUES
('arun-sanjay/countersign-dbms', 'T00', 'Countersign: the platform itself (dogfooding)', 9,
     ARRAY['docs/', 'shared/', 'vault/', 'supabase/', 'mongo/', 'ingest/README.md', 'README.md', 'PROJECT_MASTER.md']),
('rvce-el/team-alpha',           'T01', 'DBMS mini project code and Obsidian vault (shared/)', NULL, NULL),
('rvce-el/team-gamma',           'T03', 'AIML project code', NULL, NULL)
ON CONFLICT (repo_full_name) DO NOTHING;

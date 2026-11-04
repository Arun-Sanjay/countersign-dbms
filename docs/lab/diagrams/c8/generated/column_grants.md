Generated from `has_column_privilege('authenticated', ...)`: the tables on which `authenticated` holds **no table-level INSERT**, only column-level grants.

| Table | INSERT allowed on | Never client-supplied (server-owned) | UPDATE allowed on |
|:------|:------------------|:-----------------|:------------|
| `artifact` | artifact_id, team_id, project_id, milestone_no, title, type, source, visibility, owner_usn, external_ref | created_at | milestone_no, title, visibility, owner_usn, external_ref |
| `artifact_chunk` | artifact_id, version_no, author_usn, content, embedding, embedding_model, content_hash | chunk_id, created_at, visibility, tsv, chunk_no | (none: append-only) |
| `artifact_version` | artifact_id, version_no, created_by, content_hash, mongo_ref, ai_assistance | created_at, source_ref | (none: append-only) |
| `claim` | usn, team_id, project_id, milestone_no, statement, contribution_type, ai_assistance | claim_id, status, revision, created_at | milestone_no, statement, contribution_type, ai_assistance |
| `claim_evidence` | claim_id, evidence_no, kind, contribution_id, artifact_id, version_no, ref, note | added_at | (none: append-only) |
| `contribution` | usn, artifact_id, contribution_type, description, source, source_ref, occurred_at, ai_assisted | contribution_id, created_at | (none: append-only) |
| `countersign` | claim_id, endorser_usn, verdict, comment, claim_revision | signed_at | verdict, comment, claim_revision |
| `ingest_event` | (none) | delivery_id, source, event_type, repo_full_name, team_id, received_at, status, attempts, error, mongo_id, msg_id, commit_count, contribution_count, projected_at, push_ref, push_after, sender_login, followups_at | (none: append-only) |
| `submission` | team_id, project_id, milestone_no, submitted_by, attempt_no | submission_id, submitted_at | (none: append-only) |
| `submission_artifact` | submission_id, artifact_id, version_no | (none) | (none: append-only) |
| `team_member` | team_id, usn, role | joined_at | team_id, role |

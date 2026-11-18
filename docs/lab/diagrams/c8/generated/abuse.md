Run of `supabase/tests/04_abuse_cases.sql` on the local stack: **53 / 53 pass**. Each attack is made the way an attacker would make it (a direct table write with the API role, not the friendly RPC); the expected result is the SQLSTATE and rule key the database must return.

| # | Attack or rule (test description) | Result |
|--:|:--------------------------------|:--|
| | **1. Team membership: enrollment, history, role** | |
| 1 | enrollment: an outsider cannot join a P06 team directly | pass |
| 2 | enrollment: ... nor through join_team | pass |
| 3 | enrollment: so T06's claims stay invisible to him | pass |
| 4 | role: a student joins T02 asking to be lead ... | pass |
| 5 | role: ... and is made a member (T02 already has a lead) | pass |
| 6 | joined_at is server-owned (no column privilege): no backdated membership | pass |
| 7 | history: a member with no recorded work may leave with a plain DELETE | pass |
| 8 | history: a direct DELETE cannot skip leave_team's rule | pass |
| 9 | history: ... Arun is still in T00 | pass |
| 10 | laundering: Ananya joins T06 (4/4) | pass |
| 11 | laundering: ... confirms Meera's claim | pass |
| 12 | laundering: ... and can no longer leave, so the confirm is always a teammate's | pass |
| 13 | one team per project: a staffed team cannot move project | pass |
| 14 | role: at most one lead per team (partial UNIQUE index) | pass |
| 15 | role: lead or member only (CHECK) | pass |
| | **2. Locked components: nothing about a locked claim changes, on any path** | |
| 16 | lock: a direct claim INSERT on locked C1 is refused | pass |
| 17 | evidence: none can be added to a confirmed claim (direct INSERT) | pass |
| 18 | lock: a countersign on a locked claim cannot be withdrawn | pass |
| 19 | lock: ... nor flipped to a dispute | pass |
| 20 | lock: a pending claim cannot be moved onto a locked component | pass |
| 21 | lock: Karthik's C1 receipt is unchanged | pass |
| | **3. Countersign is bound to the revision the signer read** | |
| 22 | revision: editing the statement bumps claim.revision | pass |
| 23 | revision: a confirm of the text she read is refused after the edit | pass |
| 24 | revision: re-reading and signing the current revision works | pass |
| 25 | finality: an UPDATE of a confirmed claim matches no row (RLS: pending only) ... | pass |
| 26 | ... so the confirmed text is unchanged | pass |
| 27 | finality: even outside RLS a countersigned claim's content cannot change | pass |
| | **4. Evidence: own contributions only, typed refs, no duplicates** | |
| 28 | evidence: cannot cite a teammate's contribution as your own | pass |
| 29 | evidence: a url must be http(s) (no javascript: links) | pass |
| 30 | evidence: a commit must be a hex SHA | pass |
| 31 | evidence: cite A20@v2 once ... | pass |
| 32 | ... but not twice | pass |
| 33 | skill_evidence: usn must be the claim's claimant (composite FK on a superkey) | pass |
| | **5. Artifacts: no hijacking, hiding, moving or un-submitting** | |
| 34 | artifact: a submitted artifact cannot be made private | pass |
| 35 | artifact: ... nor un-submitted or moved to another component | pass |
| 36 | artifact: team_id / project_id are not updatable (no column privilege) | pass |
| 37 | artifact: cannot be created as submitted (only submitting does that) | pass |
| 38 | artifact: making your OWN solo draft private is allowed | pass |
| 39 | ... and sharing it again | pass |
| 40 | artifact: no path moves an artifact to another team | pass |
| 41 | artifact: a teammate's shared draft cannot be taken over and hidden | pass |
| 42 | artifact: faculty still see submitted A13 | pass |
| | **6. Submissions: frozen, never backdated, same component, chunks follow** | |
| 43 | submission: an earlier submission cannot gain artifacts later | pass |
| 44 | submission: submitted_at is server-owned (no backdating) | pass |
| 45 | ids are server-owned: a client cannot pick claim_id | pass |
| 46 | submission: a C4 artifact cannot be frozen into C3 | pass |
| 47 | chunks: Arun submits A17 for C3 | pass |
| 48 | chunks: ... and its text becomes visible to the teaching faculty with it | pass |
| | **7. Directory, default privileges, CIE layout, history FKs** | |
| 49 | directory: a login with no profile reads no students, rosters or skills | pass |
| 50 | default privileges: a view created later is not readable until granted | pass |
| 51 | CIE: one final component per project | pass |
| 52 | CIE: innovative/final components are out of 10 | pass |
| 53 | history: deleting a project no longer cascades through its teams' work (RESTRICT, was CASCADE) | pass |

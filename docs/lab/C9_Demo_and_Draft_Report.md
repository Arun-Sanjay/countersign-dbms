---
title-meta: "Demo and Draft Report: Unified Experiential Learning and Project Intelligence Platform (Countersign)"
author-meta: "S Arun Sanjay (1RV24CY047); Sanvid Razdan (1RV24CY051)"
subject: "CD252IA Database Management Systems, Lab Component 9"
lang: en-GB
---

::: cover
**RV College of Engineering®, Bengaluru – 59**

**Department of Computer Science and Engineering**

**DATABASE MANAGEMENT SYSTEMS (CD252IA)**

**Lab Component 9: Demo and Draft Report**

&nbsp;

**DEMO SCRIPT AND DRAFT PROJECT REPORT**

**Unified Experiential Learning and Project Intelligence Platform**

(product name: Countersign)

&nbsp;

| USN | Name |
|:--|:--|
| 1RV24CY047 | S Arun Sanjay |
| 1RV24CY051 | Sanvid Razdan |

&nbsp;

Semester V, 2026-27

Draft 0.95, 5 November 2026
:::

::: toc
:::

# Document control

| Item | Value |
|:--|:--|
| Component | 9, Demo and Draft Report (30 raw marks, part of the 120 that is reduced to 30) |
| Version | Draft 0.95, 5 November 2026: Draft 0.9 corrected after the read-only rehearsal on the live project and the lab panel's review (see the note below) |
| Authors | S Arun Sanjay (1RV24CY047), Sanvid Razdan (1RV24CY051) |
| Product | Countersign: "every mark has a receipt" |
| Builds on | C2 SRS (rev. 1.2), C3 ER diagram, C5 DFD, C6 normalization, C10 experiment (`experiments/race/`) |
| Continued in | C11 Final Report (`C11_Final_Report.md`): evaluation, limitations, future work, appendices |

This document has two parts.

* **Part I, the demo script**, is what the two of us follow during the 12-minute demonstration: who drives which screen, every click, which persona is signed in, what to say, which "Show the SQL" drawer to open, the live push, the "try to break it" segment, the concurrency race and the normalization of the paper sheet. It ends with a pre-flight checklist and a fallback for each live moment.
* **Part II, the draft report**, describes what is built: the architecture, each module, the tests and the results.

**How the facts were checked.** Every number in this document was measured on 4 or 5 November 2026. The state of the cloud project was read on 5 November 2026 with read-only SQL through the Supabase Management API: P06 has 9 claims (Sanvid's C3 claim #5 is pending, Aditi's C1 claim #6 is contested), C1 is locked, Team Beta (T02) has 3 of 4 members, and `ingest_event` holds 9 projected deliveries and 1 ignored one. The webhook secret was checked with a signed `ping` to the cloud Edge Function (HTTP 200; a ping is never stored). No row was written to the cloud database or to Atlas while this document was prepared. **Where each screenshot comes from is stated in its caption.** Figures 3 to 5 were recaptured on the local stack on 5 November 2026 from the current build (badge *Local*; same migrations and seed). Figures 13 to 16 come from the read-only rehearsal on the live project (badge *Cloud*, §14). The other screenshots are from the earlier local runs.

**Draft 0.95.** The run-of-show was corrected after the rehearsal (the tab, sidebar and glyph names, where the trace sheet opens, the Live chip below the fold, the sideways scroll, Lakshmi's typed URL, the Sync now fallback). The lab panel's review then corrected §2, §3.2, §4, §6, §7, §10.3, §10.4 to §10.6, §12 to §14 and the references.

# Part I. Demo script

# 1. The demo in one paragraph

Every RVCE lab component is marked on a paper sheet that the lab faculty signs on trust. Countersign turns that sheet into the database schema. A student **claims** what they did for a component, backs the claim with **evidence** (commits, artifact versions, links), and a teammate **countersigns** it. The faculty sees the sheet as a live grid, and every cell opens the claims and receipts behind the mark. The demo shows the sheet, a claim and a countersign, a real webhook push that arrives as evidence in about a second, the database refusing every attempt to cheat, the concurrency race behind the "last team slot", and the normalization that turned the paper sheet into these tables.

# 2. Roles, screens and personas

| Screen | Machine and window | Driven by | Signed in as | Used for |
|:--|:--|:--|:--|:--|
| **S, student** | Laptop 1, Chrome profile **CS-Student**, full screen | Arun | `arun@example.edu` (S Arun Sanjay, 1RV24CY047, team T00) | hub, claims, countersign queue, Activity tab, search |
| **F, faculty** | Laptop 2, Chrome profile **CS-Faculty**, full screen | Sanvid | `ramesh@example.edu` (Dr. Ramesh Babu, F01), later `lakshmi@example.edu` (F02) | rubric sheet, claim drawer, live toast, trace sheet, RLS |
| **T, terminal** | Laptop 2, second desktop (switch with Ctrl+→), font size 18 | Sanvid | no persona; shell in the repository root | live push, "try to break it", race |

**Why two Chrome profiles.** supabase-js keeps the session in the browser's `localStorage`, one per origin. Two windows of one profile share it, so signing in as ramesh in one window would sign arun out in the other. Separate profiles (or `http://localhost:5173` on one screen and `http://127.0.0.1:5173` on the other, which are different origins) keep the two sessions apart.

All personas use the password `Countersign@2026`. The login page has a one-click button for each, so no typing is needed.

| Persona | Role | What it shows in the demo |
|:--|:--|:--|
| arun | student, lead of T00 (P06) | files a claim, countersigns Sanvid's claim, receives the live push |
| sanvid | student, T00 | (backup) countersigns Arun's new claim if #5 was already confirmed |
| meera | student, in T01, T03 and T06 | "no recorded evidence yet" on the P06 sheet (never "ghost") |
| nikhil | student, no team in P01 | (backup) the Team Beta (T02) join, and the "team is full" refusal on T01. Not the teammate finder: he already holds every skill P01 requires, so his finder shows nobody |
| ramesh | faculty F01; teaches CD252IA (P01, P06) and also P05 (his sidebar lists P06, P05 and P01) | the rubric sheet, the claim drawer, the live toast |
| lakshmi | faculty F02, teaches only P02 | the same URL returns no rows (RLS) |
| admin | college admin | (backup) the **Ingestion** panel on the admin **Directory** page (`/admin`): inbox and consistency. **Sync now** works only if the API was started with the service key; the API of §4 step 4 runs without it, so the button answers 503 `worker_unconfigured` |

# 3. Run of show (12 minutes)

| Time | Segment | Screen S (Arun) | Screen F / terminal T (Sanvid) | Speaker |
|:--|:--|:--|:--|:--|
| 0:00 to 0:45 | 3.1 The paper sheet | `/hub` | `/sheet/P06` as ramesh | Arun |
| 0:45 to 2:00 | 3.2 The sheet is the schema (normalization) | idle | SQL drawer of the rubric sheet; `/marks/P06` | Sanvid |
| 2:00 to 3:30 | 3.3 File a claim with evidence | `/projects/P06`, File a claim | watches | Arun |
| 3:30 to 4:45 | 3.4 Countersign, and a contested claim | Countersign queue tab, Confirm | reload sheet; open Aditi's C1 cell | Arun, then Sanvid |
| 4:45 to 7:00 | 3.5 The live push | Activity tab, then `/search` | T: replay; F: toast, trace sheet | Arun |
| 7:00 to 9:00 | 3.6 Try to break it (RLS) | faculty URL, "What my faculty sees" | T: curl as arun, ramesh, anon; F: lakshmi | Sanvid |
| 9:00 to 11:00 | 3.7 The last team slot (C10) | idle | T: `demo_locks.sh S2 RR`, then `S7 RR`; heatmap | Sanvid |
| 11:00 to 12:00 | 3.8 Closer | `/hub` | `/sheet/P06` as ramesh | Arun |

## 3.1 The paper sheet (0:00 to 0:45)

**Before:** Screen F shows `/sheet/P06` as ramesh (sidebar: P06, Rubric sheet). Screen S shows Arun's `/hub`.

1. Arun holds up the printed RVCE lab evaluation sheet.
2. He points to the column "Signature of Lab Faculty".

**Say (Arun):** "This is the sheet you will sign for our project. Nine components, 120 marks reduced to 30, plus 10 and 10. Each signature is given on trust: nothing on paper says who did the ER diagram. Countersign makes this sheet the database. Every mark has a receipt." Then point at Screen F: "That is the same sheet, as live tables."

## 3.2 The sheet is the schema: normalization (0:45 to 2:00)

**Screen F (Sanvid), as ramesh on `/sheet/P06`:**

1. Point at the grid: columns C1 to C9 (raw /120, reduced /30), C10 and C11 (+10 each), Lab CIE /50. The C1 column is hatched: it is locked. The grid is wider than the screen (at 1440 px and 125 % zoom only C1 to C8 fit), so scroll it sideways (Shift + mouse wheel, or two fingers on the trackpad) to show C10, C11 and Lab CIE /50, then scroll back.
2. Click the **SQL** pill on the **Rubric sheet** panel. The drawer *Show the SQL: Rubric sheet* opens on the **SQL** tab: the view `v_rubric_sheet`, verbatim from migration 0003.
3. Click the **Algebra** tab: the join of TeamMember, Team, Student and Milestone, left outer joined with Assessment and with the claim counts. Say: "unmarked cells stay NULL; that is the outer join."
4. Click the **Concepts** tab: "Normalization: the marks sheet (UNF) rebuilt from BCNF tables". Close the drawer (Esc).
5. Click **Lab CIE marks** (top right). On `/marks/P06`, click the **SQL** pill on `v_lab_cie_marks`.

**Say (Sanvid):** "We normalized this sheet in Component 6. The paper sheets form one unnormalized relation, MARKS_SHEET, with one tuple per sheet and a repeating group of eleven lines, C1 to C11. 1NF flattens the group, so the key becomes USN, project and component number. 2NF removes the partial dependencies on the USN, the project and the team, and splits off MEMBERSHIP. 3NF removes Faculty → FacultyName. The 3NF result is not yet BCNF: in MEMBERSHIP, Team → Project has a left side that is not a key. The BCNF step splits on Team → Project, and that loses USN, Project → Team, so a trigger enforces it: one team per project. The chase tableau proves the join is lossless. The BCNF relations are projections of exactly the tables we implemented: student, project, team, team_member, milestone, assessment and faculty. The totals are not stored anywhere. 120 → 30 is computed by this view on every read, so it can never disagree with the marks." Point at the rounding note at the bottom of `/marks/P06`: "The rounding rule is one line of the view; if the department rounds differently, no stored mark changes."

## 3.3 File a claim with evidence (2:00 to 3:30)

**Screen S (Arun), as arun:**

1. Sidebar, under **P06 · CD252IA Lab 2026-27**: **Team Countersign (T00)** (`/projects/P06`).
2. Click **File a claim** (top right). In the dialog:
   * Component: **C3 ER Diagram**.
   * Kind of work: **Design**.
   * What did you do?: *Wrote the 7-step ER-to-relational mapping table and checked every (min,max) against the schema.*
   * AI assistance: **Assisted** (say why, below).
   * Cite an artifact: **A17 ER diagram v2 (draft)**.
   * **Add evidence**: a row *#1 kind* **Link** appears; paste into *Reference*:

     ```text
     https://github.com/Arun-Sanjay/countersign-dbms/blob/main/docs/lab/C3_ER.md
     ```

3. Before filing, click the **SQL** pill at the bottom left of the dialog: *Show the SQL: File a claim* opens on `file_claim()` (SECURITY INVOKER); then the **RLS** tab: `claim_insert`, `claim_evidence_insert`. Press Esc **once**: only the drawer closes, and the filled-in dialog stays as it was.
4. Click **File claim**. Toast: "Claim #10 filed for C3" (the number is the next identity value; it may differ).
5. Open the **My claims** tab: the new card is *Pending*, "Evidence (2)". (The SQL pill on this panel shows the read query, claim left-outer-joined with claim_evidence and countersign, under `claim_select`, not `file_claim()`.)

**Say (Arun):** "A claim is a row, not a feeling. The RPC runs as me, so the database checks that I am in team T00, that C3 is still open, and that the evidence belongs to my team. I declared AI assistance, because we built this with Claude Code. It is a declaration, never a detection, and the faculty never sees it next to a viva score."

## 3.4 Countersign, and a contested claim (3:30 to 4:45)

**Screen S (Arun):**

1. Open the **Countersign queue** tab (badge 1). The card is Sanvid's claim #5: "Drew ER diagram v2 in Chen notation with MILESTONE and ARTIFACT_VERSION as weak entities", revision 2, evidence A17@v1.
2. Point at the footer: "You are signing **revision 2**. If it changes before you sign, the database refuses the signature."
3. Click **Confirm**, then **Confirm claim** in the dialog. Toast: "Confirmed claim #5 ... confirmed".

**Say (Arun):** "The countersign carries the revision I read. If Sanvid had edited the claim a second earlier, the database would refuse my signature: optimistic concurrency control. The claim's status is derived by a trigger; nobody types 'confirmed'."

**Screen F (Sanvid), as ramesh:**

4. Press **Cmd+R** on `/sheet/P06` (the sheet does not refetch on focus). Sanvid's C3 cell now has a green tick (confirmed; before the countersign it was an amber clock); Arun's C3 cell has an amber clock (his new claim is pending).
5. Click **Aditi Rao's C1 cell** (4 /5, red warning triangle: contested; Team Sigma, T06). The drawer shows: Mark 4 /5, signed by Dr. Ramesh Babu, *Locked*; claim #6 *Contested*: "Wrote the entire synopsis, including the literature survey"; timeline: "Karthik M disputed revision 2: 'I wrote the literature survey (see version 2)'".
6. Click the **SQL** pill next to "Claims behind this cell". Close (Esc).

**Say (Sanvid):** "This is the faculty's review queue. Instead of a group mark, the teacher sees one disputed sentence, the version it points to, and who disagrees. Meera's row says *no recorded evidence yet*: it opens the claim flow; it is never a verdict."

## 3.5 The live push (4:45 to 7:00)

**Before (pre-flight, §4):** the API and the worker run against the cloud; the fresh push file was built with `make_demo_push.py` and its unique word is on a sticky note (example: `demoxauirh`).

**Screen S (Arun):** open the **Activity** tab of `/projects/P06` (`/projects/P06?tab=activity`).
**Screen F:** ramesh on `/sheet/P06`, scrolled down to the **Live activity** panel (below the sheet, right of *Team progress*); its chip must say **Live** (it shows *Connecting* for about a second after a load). Leave the page scrolled there so the new feed row is visible.

**Terminal T (Sanvid), one command:**

```bash
uv run --python 3.12 python scripts/replay_webhooks.py \
  --manifest /tmp/countersign-demo/manifest.json \
  --url https://oowtsesgkhhbojjmmlgk.supabase.co/functions/v1/github-webhook
```

Expected output: `live-demo-push  202  ok  status=queued`. The worker window prints one JSON line with `"projected"`.

1. Within about a second (worker poll 1 s, broadcast about 100 ms), both screens show the toast `New evidence: 1RV24CY047 · <title of the new file> · github`, and a new row in the feed.
2. **Screen F:** click the **underlined file name** in the new feed item (only the name is a link; the rest of the row is not clickable). The **trace sheet** opens: on the left the MongoDB raw event (`elp.github_events`: `_id` = the delivery id, repo and ref, `after`, the sender, `logged_at`), on the right the Postgres `ingest_event` row (delivery id, status, pusher, `mongo_id` = the same delivery id, commits → rows, the `artifact_version`s); below both, per commit, the SHA, the credited USN and the `contribution` rows matched by SHA. Open the **SQL** pill next to *Trace this push* (or **Show the SQL / Mongo query that ran** at the bottom of the sheet). Close with Esc once per sheet, pausing in between (a quick double Esc closes only the drawer), or with the ×. Point out: the faculty sees ids, times and paths, never the file's text.
3. **Screen S:** go to `/search`, type the unique word, Enter. One result card: the new file, version 1, author 1RV24CY047, with the score breakdown (FTS rank, RRF). Click the **SQL** pill: `search_chunks()`.
4. In **Ask**, type "What does the <word> note record?" and press Ask. The answer quotes the sentence with a citation marker `[1]` linked to the card. Say that it is extractive: no AI key is configured, so nothing is generated; with a key, every citation is checked on the server.

**Say (Arun):** "That was a GitHub push, signed with the webhook secret, exactly the bytes GitHub sends. The Edge Function verified the signature and wrote one row and one queue message in one transaction. The worker logged the raw event in MongoDB, keyed by the delivery id, and then projected it into Postgres with idempotent inserts. If GitHub sends it twice, nothing doubles. The commit is credited to me only because the authenticated pusher is my verified GitHub account; `git commit --author` cannot move credit."

## 3.6 Try to break it (7:00 to 9:00)

**Screen S (Arun):** type `/sheet/P06` in the address bar. The page says "This page is for faculty / admin accounts". **Say (Sanvid):** "That is only the UI. The security is in the database, so let us skip the UI."

**Terminal T (Sanvid).** The helpers were defined in pre-flight (§4, step 9); each call signs in as a persona and calls PostgREST directly with that persona's token, exactly as a malicious client would:

```bash
asuser arun "$U/rest/v1/assessment?select=usn,milestone_no,marks"
asuser arun -X POST "$U/rest/v1/assessment" \
  -d '{"usn":"1RV24CY047","project_id":"P06","milestone_no":2,
       "marks":5,"assessed_by":"F01"}'
asuser arun -X POST "$U/rest/v1/rpc/countersign_claim" \
  -d '{"p_claim_id":1,"p_verdict":"confirm"}'
asuser arun -X POST "$U/rest/v1/rpc/join_team" -d '{"p_team_id":"T06"}'
asuser ramesh -X POST "$U/rest/v1/rpc/record_assessment" \
  -d '{"p_usn":"1RV24CY047","p_project_id":"P06","p_milestone_no":1,"p_marks":4}'
asuser lakshmi "$U/rest/v1/v_rubric_sheet?select=usn&project_id=eq.P06"
curl -s "$U/rest/v1/assessment?select=usn" -H "apikey: $K"; echo
```

| # | Attempt | What the database answers (checked on the local stack, 5 Nov 2026) |
|:-:|:--|:--|
| 1 | arun reads every mark of P06 | only his own two rows (C1 5.0, C4 19.0): policy `assessment_select` |
| 2 | arun gives himself 5 marks for C2 | `42501` new row violates row-level security policy for table "assessment" |
| 3 | arun countersigns his own claim #1 | `23514 countersign_not_self` "You cannot countersign your own claim" |
| 4 | arun joins a second P06 team | `23505 one_team_per_project` "Student 1RV24CY047 is already in team T00 for project P06" |
| 5 | ramesh changes a locked C1 mark | `55000 milestone_locked` "Milestone P06/1 is locked ...; marks can no longer change" |
| 6 | lakshmi (teaches P02) reads the P06 sheet | `[]`: zero rows, no error |
| 7 | anonymous read of the marks | `42501` permission denied for table assessment. PostgREST adds the hint "GRANT SELECT ON public.assessment TO anon": that is PostgREST's generic advice for a missing privilege, not a gap. Say: "anon has no privilege on any table, by design; the hint is what we deliberately did not do." |

Every attempt fails, so nothing is written.

**Screen F (Sanvid):** user menu (the name at the bottom of the sidebar) → **Sign out** → one-click **lakshmi** (she lands on `/teaching`; her sidebar has only P02) → type `/sheet/P06` in the address bar. The sheet says "No rows visible to you. Hidden by row-level security: you do not teach P06, so the sheet returns no rows to you.", *Team progress* is hidden the same way, *Enter marks* is disabled, and after a few seconds the Live activity chip turns to **Not authorised**: RLS on `realtime.messages` refuses her the private channel `project:P06`.

**Screen S (Arun):** sidebar **What my faculty sees**. Point at the stat card *Hidden from faculty: 1*, then press **End** (Cmd+↓): the "Never shown to faculty" panel is at the very bottom, after the table of about 100 metadata rows, and says "1 private note". **Say (Arun):** "My private note exists, on my Private notes page, but it lives in a schema the API does not even expose."

**Invite the examiner:** "Name any row you think a student should not see, and we will query it as arun." (Likely asks and the answer: another student's marks → attempt 1; a private note → `private.note` is not in the API schema, PGRST205; someone else's claim in another team → `claim_select` returns nothing.)

## 3.7 The last team slot, the Innovative Experiment (9:00 to 11:00)

**Terminal T (Sanvid).** The throwaway container `elp-race-pg` runs locally; this is never the cloud database.

1. Open `experiments/race/results/over_admission_heatmap.png` (pre-opened in Preview) and give the headline: 72,000 races, 6 strategies × 3 isolation levels × N = 2, 8, 32, 100.
2. Run the fixture trigger at REPEATABLE READ:

   ```bash
   experiments/race/demo_locks.sh S2 RR
   ```

   While it runs (4 s), section 1 prints the wait-for graph: race-B waits for race-A on a `transactionid ShareLock`, race-C queues behind race-B on a `tuple` lock of the team row. The last line: **`T02 after the race: 6/4`**.

3. Run the product's trigger (capacity v2) at the same level:

   ```bash
   experiments/race/demo_locks.sh S7 RR
   ```

   The last line: **`T02 after the race: 4/4`**; the losers got `40001` (could not serialize access due to concurrent update).

**Say (Sanvid):** "Three students take the last seat of a 3-of-4 team at once. The fixture trigger locks the team row with FOR UPDATE and then counts. At READ COMMITTED that works. At REPEATABLE READ the snapshot was taken before the lock wait, so the waiter still counts three members and is admitted: 6 out of 4. A lock is not a write. That is write skew through a phantom, not a lost update. Our trigger writes the team row before counting, so a waiter gets a serialization failure instead. Over 72,000 races it never went above 4 of 4 at any isolation level, and neither did the declarative version, where capacity is a set of seat keys and the rule is a primary key. We also built the precedence graph of every two-client race in SQL with a recursive CTE: the over-admitting races are exactly the ones with the cycle T1 → T2 → T1."

## 3.8 Closer (11:00 to 12:00)

**Screen F:** sign out lakshmi, one-click **ramesh**, open `/sheet/P06`. **Screen S:** `/hub`.

**Say (Arun):** "Every mark on this sheet now has a receipt: a claim, the evidence behind it, and the teammate who signed it. The database enforces it: 30 tables with row-level security on every one, 657 pgTAP tests, the graded Test fixture still 37 of 37 SQL and 25 of 25 MongoDB, 47 API tests, 38 browser tests, and 72,000 measured races. We don't detect AI. We make every mark traceable and every claim defensible. Thank you."

# 4. Pre-flight checklist

Run in this order. Commands run from the repository root of laptop 2 unless a step says otherwise. No step prints a secret: keys are read into the environment, never echoed.

**T−60 minutes (setup)**

1. Both laptops on the same network (hotspot preferred over college Wi-Fi). Notifications off, Do Not Disturb on, battery above 80 %, chargers in. Display resolution 1440×900 or larger; browser zoom 125 %.
2. Chrome profiles **CS-Student** (laptop 1) and **CS-Faculty** (laptop 2) exist and have no other tabs.
3. On both laptops, start the web app in cloud mode and open `http://localhost:5173/login`; the badge in the top bar must say **Cloud**, not *Local*:

   ```bash
   cd web && npm run dev:remote
   ```

4. Laptop 2, window 1: the API against the cloud project and Atlas, then its health check (it must print `"postgres":"ok"` and `"mongo":"ok"`). It needs no service key: every user request runs with the caller's own token. It listens on all interfaces, so that **laptop 1 uses this API too** and the Atlas credentials stay on laptop 2 only (`atlas-credentials.env` is an admin URI and is never copied to a second machine; CLAUDE.md). The web app calls the API at `VITE_API_URL` (default `http://localhost:8000`), and Screen S needs it for **Ask** (§3.5 step 4), so start laptop 1's web app (step 3) as `VITE_API_URL=http://<laptop 2 IP>:8000 npm run dev:remote`, and check `curl -s http://<laptop 2 IP>:8000/health` from laptop 1:

   ```bash
   cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas \
     uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
   curl -s localhost:8000/health
   ```

   Without the service key, **Sync now** in the admin panel answers 503 `worker_unconfigured`; the worker of step 5 drains the queue instead.

5. Laptop 2, window 2: the worker. The service key is fetched from the Management API into this shell only, never written to a file or echoed (the same command as `docs/RUNBOOK.md` §1.2; pasting it into a silent `read -s SUPABASE_SERVICE_ROLE_KEY` prompt is equivalent):

   ```bash
   set -a; . supabase/.env; set +a
   export SUPABASE_SERVICE_ROLE_KEY="$(curl -s \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys" \
     | jq -r '.[] | select(.name=="service_role") | .api_key')"
   cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas \
     uv run python -m app.worker --loop --interval 1 -v
   ```

6. Webhook secret check. A ping is answered and dropped, so this stores nothing. It must print `ping 200 ok` (checked on 5 Nov 2026: 200):

   ```bash
   FN=https://oowtsesgkhhbojjmmlgk.supabase.co/functions/v1/github-webhook
   uv run --python 3.12 python scripts/replay_webhooks.py --only ping --url $FN
   ```

7. Build the fresh push (sends nothing). Save Appendix 1 as `/tmp/countersign-demo/make_demo_push.py`, run it, and write the printed unique word on a sticky note. Then dry-run the live command; it must print `dry push demo-...`:

   ```bash
   python3 /tmp/countersign-demo/make_demo_push.py . /tmp/countersign-demo
   uv run --python 3.12 python scripts/replay_webhooks.py --dry-run \
     --manifest /tmp/countersign-demo/manifest.json --url $FN
   ```

**T−30 minutes (state)**

8. Cloud state, read only (Supabase SQL editor, or the Management API with `"read_only": true`):

   ```sql
   SELECT claim_id, usn, milestone_no, status, revision FROM claim
   WHERE project_id = 'P06' ORDER BY claim_id;          -- #5 pending, #6 contested
   SELECT count(*) FROM team_member WHERE team_id = 'T02';           -- 3
   SELECT milestone_no FROM milestone
   WHERE project_id = 'P06' AND locked_at IS NOT NULL;               -- 1
   SELECT status, count(*) FROM ingest_event GROUP BY status;  -- no queued/failed
   ```

   If claim #5 is already confirmed (for example after a rehearsal on the cloud), switch §3.4 to the backup in §5.

9. Terminal T helpers (keep this window open; the publishable key is public by design, but it is still not printed):

   ```bash
   set -a; . web/.env.remote; set +a
   U=$VITE_SUPABASE_URL; K=$VITE_SUPABASE_ANON_KEY
   tok() { curl -s "$U/auth/v1/token?grant_type=password" -H "apikey: $K" \
     -H 'content-type: application/json' \
     -d "{\"email\":\"$1@example.edu\",\"password\":\"Countersign@2026\"}" \
     | jq -r .access_token; }
   asuser() { local t; t=$(tok "$1"); shift
     curl -s -H "apikey: $K" -H "Authorization: Bearer $t" \
       -H 'content-type: application/json' "$@"; echo; }
   asuser arun "$U/rest/v1/assessment?select=usn,milestone_no,marks"  # test: 2 rows
   ```

10. Race container: start it if it is absent (about 5 s), rehearse once (the last line must be `4/4`; the script resets T02 itself), and open the heatmap in Preview:

    ```bash
    docker ps | grep elp-race-pg || experiments/race/setup.sh
    experiments/race/demo_locks.sh S7 RR
    open experiments/race/results/over_admission_heatmap.png
    ```

11. Screen S: sign in as **arun**, open `/hub`. Screen F: sign in as **ramesh**, open `/sheet/P06`; scroll down to the **Live activity** panel and confirm its chip says **Live**, then scroll back to the top for §3.1.
12. Paper: the printed RVCE lab evaluation sheet; this script; the C6 PDF open at Part A as a backup visual.

**T−10 minutes (fallbacks warm)**

13. Local stack ready as plan B (then `npm run dev` replaces `npm run dev:remote`, and the replay drops `--url`):

    ```bash
    npx -y supabase@latest status          # the local stack is running
    scripts/reset_local.sh                  # seed state, personas, local pipeline
    scripts/mongo_local.sh                  # local Mongo container
    npx -y supabase@latest functions serve  # spare window: the local webhook
    ```

14. Fallback media: the folder `docs/screenshots/` and `web/screenshots/` open in Finder; the recorded run of §3.5 (record it during the rehearsal on the local stack) on the desktop.

**T−2 minutes**

15. Close every other app; terminal font 18; both browsers at 125 %; phone silent; timer started by the person not speaking.

# 5. Fallback plan for each live moment

| Live moment | Symptom | First fix (under 20 s) | Fallback | What to say |
|:--|:--|:--|:--|:--|
| Any page (cloud) | login spinner, "network" toast, project paused | reload once; switch to the hotspot | plan B: the local stack (step 13); every step of §3 works the same, the badge says *Local* | "Same migrations, same seed, running locally." |
| 3.2 SQL drawer | drawer empty | close and reopen | open the C6 PDF, Part A figures | the C6 summary |
| 3.3 File a claim | toast with an error | read the error aloud: it is a database rule (that is a demo too) | file the claim on C2 instead of C3, or show Figure 2 | "The error you see is the trigger's DETAIL key." |
| 3.4 Countersign | claim #5 not in Arun's queue (already confirmed) | none | Screen S: sign out, one-click **sanvid**, **Countersign queue** tab: confirm **Arun's new claim** from §3.3 | same lines, roles swapped |
| 3.4 Sheet | the C3 glyphs unchanged (still a clock, no tick) | Cmd+R (no refetch on focus) | open the cell drawer: it reads fresh | |
| 3.5 Live push | `401 invalid_signature` | wrong secret in the environment: rerun step 6 | plan B: replay to the local function (no `--url`) with the local worker | |
| 3.5 Live push | `202` but no toast after 5 s | look at the worker window: is it running and polling? | in a spare terminal, with the service key fetched as in step 5: `cd api && SUPABASE_TARGET=remote MONGO_TARGET=atlas uv run python -m app.worker --once`; the toast follows. (**Sync now** on the Ingestion panel of the admin Directory page works only if the API of step 4 was also started with the service key; without it the button answers "Sync failed ... (worker_unconfigured)", as the rehearsal showed.) | "The inbox answered in 150 ms; the projection is asynchronous by design." |
| 3.5 Live push | `duplicate: true` | the push file was used before: build a new one (Appendix 1; new SHA and word) | | "That is the replay defence: the same push twice is a no-op." |
| 3.5 Live push | worker error mentioning Mongo | Atlas not reachable from this network | the message is retried after 60 s; meanwhile show the trace sheet of an earlier push (any older feed row) | the failure table in `docs/INGESTION.md` §1 |
| 3.5 Ask | "Ask API offline" | API window crashed: restart step 4 | search still works (it runs in Postgres); skip Ask | |
| 3.6 Break it | `curl` hangs, or the token is `null` | network: source `web/.env.local` instead and rerun | open the RLS matrix test (298 assertions) and the screenshot of lakshmi's empty sheet | |
| 3.7 Race | container missing or Docker stopped | run `setup.sh` (5 s) | show the saved outputs `demo_locks_S2_RR.txt` and `demo_locks_S7_RR.txt` in `results/` | |
| 3.7 Race | the script refuses (harness running) | restart the container | saved outputs | |
| Time overrun | past 9:30 at the start of 3.7 | skip step 1 of 3.7 (heatmap) | skip §3.8 lines after the numbers | |

# 6. Questions to expect, and where the answer is

| Question | Short answer | Evidence |
|:--|:--|:--|
| What if GitHub sends the same delivery twice? | inbox key `delivery_id`; a second POST returns `duplicate: true` | `05_ingest.sql` §B; manifest row `t01-push-01-redelivery` |
| Can a student claim a teammate's commit with `git commit --author`? | no: only the verified pusher's own commits are credited | `docs/INGESTION.md` §2; `05_ingest.sql` (spoofing test) |
| Why is the capacity trigger not enough with FOR UPDATE? | the RR snapshot predates the lock wait; a lock is not a write | C10, `experiments/race/FINDINGS.md` |
| Is your schema in BCNF? | the sheet's decomposition is BCNF, at the price of one FD (USN, Project → Team) enforced by a trigger. Five implemented tables are deliberately below 3NF: `project`, `artifact`, `claim` and `skill_evidence` in 2NF, `submission` in 1NF; each copied column is pinned by a composite FK | C6 Part A, B.1 and B.2; C7 §9.2 |
| Can faculty read drafts? | no: drafts, private artifacts and private notes are never visible to them. They read claim statements, evidence, dispute comments and *submitted* text of the projects they oversee | `02_rls_matrix.sql` §C; `v_what_faculty_sees`; C8 B.2 |
| Where is the AI? | retrieval is one SQL function under RLS; generation is optional and citation-checked; no key is configured | §10.8 |
| Why MongoDB? | the raw push log, immutable note versions, portfolios ($merge): append-only documents | §10.9 |
| The T00 consistency row reads 6 · 6 · matched 5, yet "consistent"? | one Mongo commit touched only untracked files, so it is not projected by design; one Postgres row is a seeded row whose `source_ref` is not a full SHA, so it is outside the pipeline; nothing is missing on either side | `api/app/consistency.py`; Figure 16 |

# 7. What the demo changes in the cloud database

The demo itself writes, as the signed-in personas and through the normal RPCs: one claim with two evidence rows (§3.3), one countersign (§3.4), and one projected push (§3.5: one `ingest_event`, one artifact, one `artifact_version`, one contribution, its chunks, and one Mongo `github_events` document). The "try to break it" calls write nothing. These rows are kept. History tables have no delete path in the app once work is recorded: `ON DELETE RESTRICT` keys (FR10), and a countersign, a mark or a projected push cannot be withdrawn by its author. The one user-level delete is narrow: the claimant may withdraw their own claim **while it is still pending** (policy `claim_delete`); a countersigned claim cannot be withdrawn. Undoing demo writes is an administrator's job, by id, with the recipes in `docs/RUNBOOK.md` §5.2. A second performance therefore needs a new push file (`make_demo_push.py` again) and uses the backup in §5 for the countersign.

# Part II. Draft report

# 8. Introduction

**Problem.** In RVCE's experiential-learning (EL) labs, work is scattered across WhatsApp, Drive and personal GitHub accounts; faculty grade team projects on paper rubrics and sign each component on trust; individual contribution is invisible; teammates are found through friends, not skills; and no record of the work survives the semester (C1 Synopsis, C2 SRS §1).

**Thesis.** "Every mark has a receipt." The lab rubric becomes the schema. Each rubric cell links to student claims; each claim is backed by evidence rows; teammates countersign each claim; the faculty sees the sheet as a live view and reads the receipts behind any mark. Contribution is recorded where the work happens (GitHub pushes, artifact versions, notes) and is never inferred by AI detection, which is an explicit non-goal (C2 §2.7).

**Objectives of this build.**

1. A normalized PostgreSQL schema that implements the paper sheet, claims, evidence, countersigns, teams, skills and evidence ingestion, with the graded Test fixture (Q1–Q37, M1–M25) still passing unchanged.
2. Security in the database: row-level security on every table, `security_invoker` views, RPCs that run as the caller, a private schema for personal notes.
3. Integrity under concurrency, measured: the "last team slot" experiment (C10).
4. A real MongoDB component: the raw event log, immutable note versions and portfolios, kept consistent with Postgres by contract.
5. A web application that shows the SQL behind every panel.

# 9. System architecture

![Figure 1. System architecture as built on 5 November 2026. Solid boxes run and are exercised by tests; the dashed box is code that is built but has no API key configured. Edge labels give the identity each call runs as.](diagrams/c9/c9_fig1_architecture.png){width=100%}

| Tier | Component | Runs as | Notes |
|:--|:--|:--|:--|
| Client | Web SPA (`web/`): Vite, React 19, TypeScript, Tailwind, shadcn/ui, supabase-js, TanStack Query, zod | the signed-in user (publishable key + user JWT) | every query is filtered by RLS; the "Show the SQL" drawer shows the verbatim SQL of each panel |
| API | FastAPI (`api/`): `/notes`, `/consistency`, `/ask`, `/ingest/trace`, `/ingest/status`, `/ingest/drain`, `/health` | the caller's JWT, forwarded to PostgREST | never uses the service key for a user request |
| Worker | `app.worker`: pgmq consumer | `service_role` (the pipeline RPCs are service-only) | Mongo raw log, then the Postgres projection |
| Inbox | Supabase Edge Function `github-webhook` | `service_role`, after verifying the HMAC signature | answers 202 in about 150 ms |
| Database | PostgreSQL 17.11 on Supabase (ap-south-1): 29 tables in `public`, `private.note`, 6 views, 73 functions in `public`/`private`/`app`, 102 policies, 28 triggers; extensions pgvector 0.8.2, pgmq 1.5.1 and pgcrypto 1.3 (versions read on the local stack) | `authenticated` (users), `service_role` (pipeline) | migrations 0001 to 0006 |
| Documents | MongoDB 8 on Atlas, database `elp`: `github_events`, `notes`, `note_versions`, `portfolios`, with `$jsonSchema` validators | API and worker only | the browser never talks to MongoDB |
| Experiment | local `postgres:17` container `elp-race-pg` | | 72,000 races; never the cloud project |

**Identity rules** (C2 §3.5.1). The browser only holds the publishable key. Users sign in with Supabase Auth; `app_user` maps `auth.users` to a student USN or a faculty id, and the role-consistency CHECK makes the mapping exact. Helper functions in schema `app` (`current_usn()`, `current_faculty_id()`, `is_team_member()`, `teaches_project()`, `oversees_project()`) are used inside the policies. The only `service_role` paths are the Edge Function and the worker.

# 10. Implementation of each module

## 10.1 Core schema (migrations 0001 and 0002)

Migration 0001 is the frozen fixture schema (13 tables, Appendix A of the master file) with RLS switched on. Migration 0002 adds the application model as append-only columns, constraints and new tables, so Q1–Q37 still return the outputs of Appendix H:

* **Terms and offerings:** `academic_term` (with an EXCLUDE constraint against overlapping terms), `course_offering`, `enrollment`; `project.offering_id`.
* **Identity:** `app_user` with the role-consistency CHECK; `student_identity` (verified GitHub accounts, migration 0005).
* **Work:** `artifact` gains `visibility` (private, team, submitted), `owner_usn`, `external_ref` and a composite FK `(team_id, project_id) → team`; the weak entity `artifact_version`; `contribution` gains `source`, `source_ref`, `occurred_at`, `ai_assisted` and an idempotency key.
* **Assessment:** `milestone.counts_in_reduced` and `locked_at`; `submission`, `submission_artifact`; `assessment` at component grain (one row per student and component, `assessed_by` the signing faculty).
* **Claims:** `claim`, the weak entity `claim_evidence`, `countersign` (C3 Figure C3-2 shows the ER diagram).
* **Skills:** `skill_evidence`, `course_skill`, `project_skill.min_level`.
* **Private vault:** `private.note`, in a schema PostgREST does not expose.

History is protected by `ON DELETE RESTRICT` foreign keys on every table that records work (FR10). Integrity rules that span rows are triggers, each with a stable rule key in the error DETAIL that the web app maps to a field message: team capacity v2 (writes the team row, then counts), one team per project (writes the student row), membership required for every contributor, claimant, chunk author and assessed student, marks not above the maximum, no change after a component is locked, countersign by a teammate who is not the claimant and on the revision they read.

## 10.2 Security (migration 0003)

* RLS is enabled on all 30 tables; `authenticated` gets no default privileges on new relations; `anon` can read nothing.
* Directory tables are readable by any signed-in user; team content only by the team's members; staff read, for the projects they oversee, contribution metadata, claim statements, evidence, dispute comments and *submitted* content (never drafts or private items); marks are written only by the teaching faculty (or an admin) in their own name; a student reads only their own marks; private artifacts and notes only by their owner.
* Six `security_invoker` views, so the caller's RLS applies inside them: `v_rubric_sheet`, `v_lab_cie_marks`, `v_contested_claims`, `v_faculty_team_progress`, `v_semester_hub`, `v_what_faculty_sees`.
* Realtime: the contribution trigger broadcasts ids and a time to private topics `team:<id>` and `project:<id>`; RLS on `realtime.messages` decides who may join (migration 0005).

## 10.3 RPC layer (migration 0004)

| RPC | Security | What it does | Concept |
|:--|:--|:--|:--|
| `semester_hub()` | invoker | the landing page for whoever is signed in | joins over enrollment, offering, team, milestone |
| `join_team`, `leave_team` | invoker | membership with capacity, enrolment and history guards | triggers, write-the-parent locking |
| `find_teammates`, `find_full_cover` | invoker | complementary finder: Missing = Required(P) − Mine, then students ranked by how many Missing skills they cover (a partial division, with a `covers_all` flag); `find_full_cover` is the thresholded full division | relational division |
| `skill_gap`, `skill_subtree` | invoker | required minus shown skills; recursive skill tree with CYCLE | EXCEPT, WITH RECURSIVE |
| `submit_milestone` | invoker | freezes artifact versions into a submission in one transaction | atomicity |
| `file_claim`, `add_claim_evidence`, `countersign_claim` | invoker | claim, evidence, countersign with revision check | weak entities, OCC |
| `record_assessment`, `lock_milestone` | invoker | marks within bounds; one-way lock | `SELECT … FOR SHARE`, conditional UPDATE |
| `my_private_notes`, `save_private_note`, `delete_private_note` | definer, explicit owner check | the private vault | schema isolation |
| `search_chunks` (0005) | invoker | keyword (idf-weighted) and vector lists fused by RRF in one statement | hybrid retrieval under RLS |

## 10.4 Claims, evidence and countersign

The student project page (`/projects/:id`) has five tabs: Components, My claims, **Countersign queue** (teammates' pending claims), Artifacts and Activity. A claim states what one student did for one component, its kind of work and a declared AI assistance (none, assisted, generated). Evidence rows are typed (`contribution`, `artifact_version`, `url`, `file`, `commit`) and must belong to the claimant's team; a cited contribution must be the claimant's own. A countersign is a confirm or a dispute (a dispute needs a comment) by a teammate, bound to the claim revision the signer read. The claim status is derived by trigger: any dispute makes it *contested*, a confirm without a dispute makes it *confirmed*; evidence is frozen once the claim is no longer pending.

![Figure 2. Filing a claim (local stack). The dialog states the rules: at least 10 characters, declared AI assistance, a cited artifact whose latest version becomes evidence #1 in the same transaction.](diagrams/c9/shots/claim.png){width=70%}

![Figure 3. Arun's **Countersign queue** tab (local stack, recaptured on 5 November 2026). Sanvid's C3 claim #5 is pending (clock); the footer names the revision being signed.](diagrams/c9/shots/countersign.png){width=100%}

## 10.5 The rubric sheet and Lab CIE marks

The faculty's `/sheet/:projectId` renders `v_rubric_sheet`: one row per student with a Sl. No., one cell per (student, component), the mark, a glyph for the claim status (a tick for confirmed, a clock for a pending countersign, a triangle for contested), a red "no claim" marker for a mark with no claim behind it, hatching for locked components, a signature row, and the raw /120, reduced /30, C10, C11 and /50 columns. Clicking a cell opens the drawer with the mark, its signer and lock, and the claims → evidence → countersigns behind it. `v_lab_cie_marks` derives the /50 total on every read (round(raw × 30 / 120, 1) + C10 + C11; the rounding rule is still to be confirmed with the course faculty). The normalization that leads from the paper sheet to these tables is C6 Part A (Figure 6).

![Figure 4. The rubric sheet for P06 as Dr. Ramesh Babu (local stack, recaptured on 5 November 2026 at a 1920-pixel window so that every column fits; at 1440 pixels the grid scrolls sideways). Illustrative marks from the demo seed.](diagrams/c9/shots/sheet.png){width=100%}

![Figure 5. The drawer behind Aditi Rao's C1 cell (local stack, recaptured on 5 November 2026): a locked mark and a contested claim with the dispute.](diagrams/c9/shots/drawer.png){width=45%}

![Figure 6. From the paper sheet (UNF) to 1NF and the 2NF decomposition (C6, Figure 2a, re-rendered with a smaller margin). The full UNF → BCNF derivation, the minimal cover and the chase-tableau proof are in C6 Part A.](diagrams/c9/c9_fig3_sheet_normalization.png){width=100%}

## 10.6 Teams and skills

`/team` lists the teams of a project with their capacity, the teammate finder (complements, not clones: students outside any team of the project who hold the skills the caller lacks), the skill gap (declared versus verified levels; *verified* is `max(level)` over all `skill_evidence` rows of the caller for that skill, with no filter on claim status, and those rows are seeded today: deriving them from confirmed claims is planned, C2 FR8 and C11 FR8) and the skill tree (WITH RECURSIVE over `skill.parent_skill_id`, SEARCH DEPTH FIRST, CYCLE).

![Figure 7. Team and skills (local stack): capacity per team, the finder with its relational algebra, the declared versus verified skill gap.](diagrams/c9/shots/finder.png){width=100%}

## 10.7 Ingestion: inbox → log → projection (migrations 0005 and 0006)

![Figure 8. The live push of §3.5, step by step.](diagrams/c9/c9_fig2_live_push.png){width=85%}

The design is `docs/INGESTION.md`. In short: the Edge Function verifies `X-Hub-Signature-256` in constant time and calls `ingest_receive()`, which inserts the `ingest_event` row and sends the pgmq message in one transaction. The worker reads the queue oldest first, upserts the raw push into Mongo `github_events` with `_id` = the delivery id (e-mail addresses replaced by their sha256), marks the event `raw_stored`, and calls `project_push()`, which writes artifacts, versions, contributions and chunks with `ON CONFLICT DO NOTHING` on an idempotency key at every level. Failures are counted (`ingest_fail`, migration 0006); after 5 attempts a message is dead-lettered. Credit goes only to commits whose claimed author is the authenticated, verified pusher and a member of the repository's team; everything else is logged but not credited. `GET /consistency` checks per team and author that every credited commit in the raw log is in the projection and the reverse.

**Cloud state on 5 November 2026:** 16 replayed fixture deliveries gave 9 projected deliveries and 1 ignored (feature branch); the other 6 were a ping, an `issues` event, two signature failures (401) and two duplicates. They produced 29 GitHub contributions; `artifact_chunk` holds 58 chunks.

## 10.8 Search and Ask

`search_chunks()` is a SECURITY INVOKER SQL function, so RLS filters every candidate. It searches only the newest snapshot of each projected artifact, ranks keyword matches by Σ idf² over the query words (a rare word outweighs common ones), adds a vector list when a query embedding is passed, and fuses both by reciprocal rank fusion, score Σ 1/(60 + rank), in the same statement. `POST /ask` retrieves as the caller and, with no `ANTHROPIC_API_KEY` configured (the current state), returns an extractive answer: the best-matching sentence of each of the top three chunks, each cited. The generative path (Claude with citations, server-side check that every cited chunk is among the retrieved ones and that every quote occurs in its chunk) and the embedding path (Voyage, 1024 dimensions, HNSW) are built and unit-tested with stubs, but have never been run against the real services.

## 10.9 MongoDB

Database `elp` on Atlas holds `notes` (the current state of each note), `note_versions` (one immutable receipt per save, `_id = "<note_id>:<n>"`, so a version number is single-use), `github_events` (the raw log) and `portfolios` (built by one aggregation with `$unionWith`, `$group` and `$merge`). `mongo/validators.js` adds strict `$jsonSchema` validators and unique indexes, and `scripts/check_mongo_validators.sh` shows that they accept the fixture's own writes and reject six malformed ones. `POST /notes` saves a note version and bumps the note in one multi-document transaction; a stale base version gets 409. The graded queries M1–M25 still pass on the validated collections.

## 10.10 Web application

Pages: login (one-click personas), about, student (`/hub`, `/team`, `/projects/:id`, `/notes`, `/faculty-view`), faculty (`/teaching`, `/sheet/:id`, `/contested`, `/marks/:id`), admin (`/admin` with the Ingestion panel) and `/search` for everyone. Route guards are convenience only; the database decides. Every data panel has a **SQL** pill that opens the *Show the SQL* drawer with four tabs: the verbatim SQL (extracted from the migrations by `npm run sql:extract`, so it cannot drift), the relational algebra, the RLS policies that apply, and the syllabus concepts (Units I to V). Forms use zod rules that mirror the CHECK constraints; every database error's DETAIL key is mapped to a field message (three layers: zod, the RPC's pre-check, the constraint or trigger).

![Figure 9. The Show-the-SQL drawer, Algebra tab, for the semester hub (local stack).](diagrams/c9/shots/sqldrawer.png){width=75%}

## 10.11 Innovative Experiment harness (C10)

`experiments/race/` loads the fixture schema and the verbatim Q35 trigger into a throwaway container, then races N clients (N = 2, 8, 32, 100, released by an asyncio barrier) for Team Beta's last seat, for six strategies at three isolation levels, 1000 trials per cell. Results are stored in `exp.experiment_run`, `exp.experiment_attempt` and `exp.schedule_log`; `analysis.sql` builds the precedence graph of each two-client race and finds cycles with WITH RECURSIVE; `analysis_selftest.sql` checks that SQL on six hand-solved textbook schedules (all PASS); `demo_locks.sh` prints the live wait-for graph from `pg_locks` joined with `pg_blocking_pids()`.

# 11. Testing summary

| Suite | Count | Result | What it covers |
|:--|--:|:--|:--|
| pgTAP `01_constraints.sql` | 45 | pass | one violating statement per integrity rule, with the expected SQLSTATE |
| pgTAP `02_rls_matrix.sql` | 298 | pass | persona × relation → visible rows; privacy; write permissions |
| pgTAP `03_rpc.sql` | 126 | pass | every RPC: happy path and refusal paths per persona |
| pgTAP `04_abuse_cases.sql` | 53 | pass | review findings replayed as an attacker would, through direct table writes |
| pgTAP `05_ingest.sql` | 119 | pass | inbox idempotency, projection, trust model, search under RLS, Realtime topics |
| pgTAP `06_ingest_worker.sql` | 16 | pass | failure bookkeeping and dead letters |
| **pgTAP total** | **657** | **pass** |  |
| Fixture SQL Q1–Q37 | 37 | 37/37 | outputs diffed against master Appendix H (plain PG17, C collation) |
| Fixture MongoDB M1–M25 | 25 | 25/25 | outputs checked on `mongo:8` |
| API `test_api.py` | 24 | pass | auth, team access, privacy tiers, notes history, consistency |
| API `test_worker.py` | 23 | pass | worker idempotency, Mongo and projection failures, `/ask` permissions |
| **API total** | **47** | **pass** |  |
| Web e2e (Playwright, 10 specs) | 38 | pass | login per persona, claim, countersign, team, sheet and marks, RLS as lakshmi, privacy and role guard, SQL drawer, notes, live ingestion |
| Race experiment | 72,000 races | as reported | over-admission per strategy × isolation × N |

How to run each suite (repository root; the local stack must be in its seed state, so run `scripts/reset_local.sh` first and nothing else at the same time):

```bash
npx -y supabase@latest test db                        # pgTAP, 657
scripts/test_fixture.sh                               # Q1-Q37 against Appendix H
scripts/test_mongo_fixture.sh                         # M1-M25
(cd api && MONGO_TARGET=local uv run pytest -q)       # API and worker, 47
(cd web && npm run e2e)                               # Playwright, 38
uv run --python 3.12 --with asyncpg experiments/race/harness.py --fresh --trials 1000
```

The web gate (G8) also runs `tsc` (strict), `oxlint --max-warnings 0` and `vite build` before the e2e suite. A CI workflow (`.github/workflows/fixture.yml`) that reruns the fixture comparison exists in the repository but has not been pushed, because the GitHub token lacks the `workflow` scope.

# 12. Results

**Functional.** Two different levels of evidence, kept apart:

* **Exercised end to end by the local e2e suite** (38 tests on the local stack, §11): signing in as every persona, filing a claim with evidence, countersigning, joining a team with the capacity and enrolment refusals, entering marks within and above the maximum, locking a component, private notes, the role guards, and a live signed push through the Edge Function and the worker to the toast, the feed, the trace sheet and search (spec 10).
* **Checked on the cloud project, read-only**, in the rehearsal of 5 November 2026 (§14): every persona signs in; every screen of §3 loads with real data (hub, rubric sheet and drawer, Lab CIE marks, the File a claim and Confirm dialogs up to the last button, the countersign queue, the Activity tab and the staff feed, the trace sheet of an earlier push, search and extractive Ask, the role guard, Lakshmi's empty sheet, "What my faculty sees", the contested queue, the admin inbox and the consistency panel, which reads *all consistent*). The 16 replayed deliveries were projected on the cloud earlier (§10.7).
* **Not yet exercised on the cloud:** filing a claim, countersigning, joining, entering marks, locking, and a live push with its toast. The first live push and the first countersign on the cloud will be the demo itself.

**Security.** Every attempt in §3.6 fails in the database, not in the UI, and the RLS matrix (298 assertions) pins the visible row count of every persona on every relation.

**Concurrency (C10).** Over-admission rate per strategy and isolation level, all N pooled (1000 races per cell and N):

| Strategy | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|:--|:-:|:-:|:-:|
| S1 naive check-then-insert | 100 % (worst 103/4) | 100 % (103/4) | 0 % |
| S2 fixture trigger Q35 (lock team row, then count) | 0 % | **100 % (103/4)** | 0 % |
| S3 conditional counter UPDATE | 0 % | 0 % | 0 % |
| S4 naive + retry on 40001 | 100 % | 100 % | 0 % |
| S6 declarative seat keys | 0 % | 0 % | 0 % |
| S7 write-the-parent (product capacity v2) | 0 % | 0 % | 0 % |

![Figure 10. Over-admission heatmap from `experiments/race/results/` (72,000 races, 2,556,000 attempts).](../../experiments/race/results/over_admission_heatmap.png){width=100%}

**Ingestion.** 16 deliveries → 9 projected, 1 ignored, 0 failed on the cloud; the same replay on the local stack is checked by `/consistency` as *all consistent*, and `--reproject-from-log` rebuilds an identical projection from the Mongo log.

# 13. Further screenshots

![Figure 11. Lakshmi (F02) opens the P06 sheet: RLS returns no rows (local stack).](diagrams/c9/shots/rls.png){width=100%}

![Figure 12. Lab CIE marks, derived by `v_lab_cie_marks` (local stack, after the e2e suite had recorded C2 marks).](diagrams/c9/shots/marks.png){width=100%}

![Figure 13. The trace sheet of an earlier T00 push, opened from the underlined file name in the staff feed (live project, read-only rehearsal, 5 November 2026): the MongoDB raw event (`_id` = the delivery id) beside the Postgres `ingest_event` row (`mongo_id` = the same id), and below, commit c6e8064 matched by SHA to contributions 57 and 58.](diagrams/c9/shots/trace.png){width=45%}

![Figure 14. Search for "CATME" as Arun with the score breakdown (FTS rank, vector rank, RRF), and the extractive Ask answer with citations (live project, read-only rehearsal).](diagrams/c9/shots/search.png){width=100%}

![Figure 15. The Ingestion panel on the admin Directory page: inbox rows with status chips (9 projected, 1 ignored) and the Sync now button (live project, read-only rehearsal).](diagrams/c9/shots/ingestion.png){width=100%}

![Figure 16. Mongo ↔ Postgres consistency on the same page: *all consistent* (live project, read-only rehearsal). The T00 row for 1RV24CY047 reads 6 · 6 · matched 5: one Mongo commit touched only untracked files, and one Postgres row is outside the pipeline.](diagrams/c9/shots/consistency.png){width=100%}

![Figure 17. Admin directory: row counts per table read through RLS, and the persona mapping (local stack).](diagrams/c9/shots/admin.png){width=100%}

**Not captured:** the live toast. It needs the one-time live push of §3.5 (Appendix 1), which the read-only rehearsal deliberately did not send; the toast is checked by e2e spec 10 on the local stack.

# 14. Status and next steps to C11

| Area | State on 5 Nov 2026 |
|:--|:--|
| Database (0001 to 0006), RLS, RPCs, ingestion | built, on the cloud project, tested |
| Web app and API | built, tested; run locally (Vercel deployment needs a login) |
| MongoDB on Atlas | validators, notes and note versions applied |
| Cited assistant | extractive only: no Anthropic or Voyage key configured |
| GitHub integration | a repository webhook with replayed, signed fixtures; no GitHub App; identity verification is set by an admin |
| CI | workflow file written, not pushed (missing `workflow` scope) |
| Demo rehearsal | **done, read-only, on the live project** (5 November 2026, web in cloud mode on a laptop, API without a service key): all 7 personas sign in; every screen of §3 passes (§12); break-it attempts 1, 6 and 7 and the race demo pass; the consistency panel reads *all consistent*. Nothing was written: the claim and Confirm dialogs were cancelled, so claim #5 stays pending for the demo; one signed `ping` stored nothing; one click on **Sync now** answered 503 `worker_unconfigured` because the API had no service key (the §5 fallback is therefore the worker with `--once`). Eight script steps were corrected (Draft 0.95). **Not verified on the cloud:** the live toast, the worker's `"projected"` line, and search and Ask on the demo word; they need the one-time push of Appendix 1 and pass locally in e2e spec 10. Break-it attempts 2 to 5 are writes and were not run on the cloud (pgTAP `04_abuse_cases` covers them) |

C11 extends this report with the evaluation against the SRS, the limitations, future work and the appendices (full schema listing, test inventory, user manual).

# References

1. R. Elmasri and S. B. Navathe, *Fundamentals of Database Systems*, 7th ed., Pearson, 2016.
2. PostgreSQL Global Development Group, *PostgreSQL 17 Documentation*: Chapter 13 (Concurrency Control) and Chapter 5.9 (Row Security Policies).
3. D. R. K. Ports and K. Grittner, "Serializable Snapshot Isolation in PostgreSQL", *Proc. VLDB Endowment* 5(12), 2012.
4. Supabase documentation: Row Level Security, Realtime Authorization, Edge Functions, Queues (pgmq).
5. GitHub documentation: Webhook events and payloads; Validating webhook deliveries.
6. MongoDB 8.0 Manual: Schema Validation; Transactions; `$merge`.
7. Project documents: C2 SRS rev. 1.2, C3 ER, C5 DFD, C6 Normalization, `docs/INGESTION.md`, `experiments/race/README.md` and `FINDINGS.md`.

# Appendix 1. `make_demo_push.py` (builds the push for §3.5; sends nothing)

Save it outside the repository (for example `/tmp/countersign-demo/`). It copies the repository, pusher and sender blocks of the real fixture `ingest/fixtures/t00_push_01.json` (T00's repository, pushed by Arun's verified GitHub account) and adds one new commit with a random SHA that adds `docs/demo-<word>.md`, its text inline as `x_contents`, exactly as `web/e2e/ingest.ts` does for e2e spec 10. A random SHA makes the push key `(repository, ref, after)` new, so the inbox does not treat it as a duplicate. The file goes under `docs/`, a tracked path of T00, and is filed under T00's default component C9.

```python
"""Build ONE fresh push for the live demo (stdlib only). Sends nothing.
Usage: python3 make_demo_push.py <repo root> <output dir>"""
import datetime, json, pathlib, secrets, sys, uuid

root, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
base = json.loads((root / "ingest/fixtures/t00_push_01.json").read_text())
word = "demo" + "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz")
                        for _ in range(6))
sha, before = secrets.token_hex(20), base.get("after") or secrets.token_hex(20)
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
path = f"docs/demo-{word}.md"
who = {"name": "Arun Sanjay", "username": "Arun-Sanjay",
       "email": "228202223+Arun-Sanjay@users.noreply.github.com"}
repo = base["repository"]["html_url"]
text = (f"# {word}\n\nThe {word} note records why a countersign is refused "
        "when the claim revision changed.\n")
commit = {"id": sha, "tree_id": secrets.token_hex(20), "distinct": True,
          "message": f"docs: {word} demo note", "timestamp": now,
          "url": f"{repo}/commit/{sha}", "author": who, "committer": who,
          "added": [path], "removed": [], "modified": [],
          "x_contents": {path: text}}
head = {k: v for k, v in commit.items() if k != "x_contents"}
payload = {**base, "before": before, "after": sha, "created": False,
           "deleted": False, "forced": False,
           "compare": f"{repo}/compare/{before[:12]}...{sha[:12]}",
           "commits": [commit], "head_commit": head}
(out / "push.json").write_text(json.dumps(payload, indent=1))
row = {"name": "live-demo-push", "file": "push.json", "event": "push",
       "delivery": f"demo-{uuid.uuid4()}", "sign": "valid",
       "expect": {"http": 202, "status": "queued", "duplicate": False}}
(out / "manifest.json").write_text(json.dumps({"deliveries": [row]}, indent=1))
print("unique word:", word)
```

Checked on 5 November 2026: the script ran, and `replay_webhooks.py --dry-run` with its manifest and the cloud URL printed `live-demo-push - dry push demo-... 2831 bytes, sign=valid`. It has not been delivered to the cloud (that is the live moment); the same payload shape is delivered and projected by e2e spec 10 on the local stack.

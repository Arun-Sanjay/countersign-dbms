Run of `supabase/tests/02_rls_matrix.sql` on the local stack: **298 / 298 pass** (256 matrix cells + 42 targeted checks).

| # | Targeted check (test description) | Result |
|--:|:--------------------------------|:--|
| 257 | every public table has RLS enabled | pass |
| 258 | every public table has at least one policy | pass |
| 259 | every public view is security_invoker | pass |
| 260 | anon holds no SELECT/INSERT privilege on any public table or view | pass |
| 261 | authenticated cannot TRUNCATE (TRUNCATE bypasses RLS) | pass |
| 262 | every policy is scoped TO authenticated | pass |
| 263 | private artifact A18 is invisible to its owner's teammate (Arun) | pass |
| 264 | versions of a private artifact are invisible to a teammate | pass |
| 265 | a student cannot read a teammate's marks | pass |
| 266 | rubric sheet shows a teammate's cells but not their marks | pass |
| 267 | private notes are not readable directly (schema private has no grants) | pass |
| 268 | "what faculty sees" never lists a private artifact | pass |
| 269 | the owner sees their own private artifact A18 | pass |
| 270 | ...but it is absent from the owner's "what faculty sees" view | pass |
| 271 | faculty never see a private artifact, even in a project they teach | pass |
| 272 | faculty read chunk text only once it is submitted | pass |
| 273 | lab CIE: (5+19)*30/120 = 6.0 and (4.5+18)*30/120 = 5.625 -> 5.6 | pass |
| 274 | F02 (does not teach CD252IA) sees no P06 claims | pass |
| 275 | F02 sees no P06 marks | pass |
| 276 | a student cannot write marks (not even their own) | pass |
| 277 | a student cannot file a claim in a teammate's name | pass |
| 278 | a student cannot file a claim for another team | pass |
| 279 | a student files their own claim for their own team | pass |
| 280 | a teammate countersigns a pending claim | pass |
| 281 | ...and the derived claim status becomes confirmed | pass |
| 282 | a student cannot countersign in someone else's name | pass |
| 283 | a confirmed claim cannot be edited (only pending claims are) | pass |
| 284 | a student cannot lock a milestone (no row is updatable) | pass |
| 285 | a student cannot create a private artifact owned by someone else | pass |
| 286 | a student cannot TRUNCATE | pass |
| 287 | a teamless student joins a team as themself | pass |
| 288 | a student cannot add someone else to a team | pass |
| 289 | faculty cannot file claims | pass |
| 290 | the teaching faculty enters a mark in their own name | pass |
| 291 | faculty cannot sign a mark in another faculty's name | pass |
| 292 | the teaching faculty locks a milestone | pass |
| 293 | faculty may change nothing on a milestone except locked_at | pass |
| 294 | faculty cannot unlock a locked milestone | pass |
| 295 | faculty cannot mark a project they do not teach | pass |
| 296 | faculty cannot lock a milestone of a project they do not teach | pass |
| 297 | an admin can unlock a milestone | pass |
| 298 | even an admin does not see private artifacts | pass |

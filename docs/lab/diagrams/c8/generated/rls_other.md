Run of `supabase/tests/02_rls_matrix.sql` on the local stack: **301 / 301 pass** (256 matrix cells + 45 targeted checks).

| # | Targeted check (test description) | Result |
|--:|:--------------------------------|:--|
| 257 | every public table has RLS enabled | pass |
| 258 | every public table has at least one policy | pass |
| 259 | every public view is security_invoker | pass |
| 260 | anon holds no SELECT/INSERT privilege on any public table or view | pass |
| 261 | authenticated cannot TRUNCATE (TRUNCATE bypasses RLS) | pass |
| 262 | every policy is scoped TO authenticated | pass |
| 263 | private artifact A92 is invisible to its owner's teammate (Meera) | pass |
| 264 | versions of a private artifact are invisible to a teammate | pass |
| 265 | Arun's private artifact A18 is invisible to other students | pass |
| 266 | a student cannot read a teammate's marks | pass |
| 267 | rubric sheet shows a teammate's cells but not their marks | pass |
| 268 | private notes are not readable directly (schema private has no grants) | pass |
| 269 | "what faculty sees" never lists a private artifact | pass |
| 270 | the owner sees their own private artifact A92 | pass |
| 271 | ...but it is absent from the owner's "what faculty sees" view | pass |
| 272 | Arun (solo team T00) sees his own private artifact A18 | pass |
| 273 | ...and A18 is absent from his "what faculty sees" view | pass |
| 274 | faculty never see a private artifact, even in a project they teach | pass |
| 275 | faculty read chunk text only once it is submitted | pass |
| 276 | lab CIE: (4+16)*30/120 = 5.0, (4.5+17) -> 5.375 -> 5.4, (3+12) -> 3.75 -> 3.8, (5+19) -> 6.0 | pass |
| 277 | F02 (does not teach CD252IA) sees no P06 claims | pass |
| 278 | F02 sees no P06 marks | pass |
| 279 | a student cannot write marks (not even their own) | pass |
| 280 | a student cannot file a claim for another team | pass |
| 281 | a student files their own claim for their own team | pass |
| 282 | a student cannot lock a milestone (no row is updatable) | pass |
| 283 | a student cannot TRUNCATE | pass |
| 284 | a student cannot file a claim in a teammate's name | pass |
| 285 | a teammate (Meera) countersigns a pending claim | pass |
| 286 | ...and the derived claim status becomes confirmed | pass |
| 287 | a student cannot countersign in someone else's name | pass |
| 288 | a student cannot create a private artifact owned by someone else | pass |
| 289 | a confirmed claim cannot be edited (only pending claims are) | pass |
| 290 | a teamless student joins a team as themself | pass |
| 291 | a student cannot add someone else to a team | pass |
| 292 | faculty cannot file claims | pass |
| 293 | the teaching faculty enters a mark in their own name | pass |
| 294 | faculty cannot sign a mark in another faculty's name | pass |
| 295 | the teaching faculty locks a milestone | pass |
| 296 | faculty may change nothing on a milestone except locked_at | pass |
| 297 | faculty cannot unlock a locked milestone | pass |
| 298 | faculty cannot mark a project they do not teach | pass |
| 299 | faculty cannot lock a milestone of a project they do not teach | pass |
| 300 | an admin can unlock a milestone | pass |
| 301 | even an admin does not see private artifacts | pass |

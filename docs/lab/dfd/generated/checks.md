| Result | Check |
|-|---------|
| PASS | Identifiers: 31 context flows, 55 Level 1 external flows and 59 Level 1 store flows, all with unique ids |
| PASS | Level 0: every flow is labelled and connects an external entity with process 0 |
| PASS | Level 0: every external entity exchanges at least one flow with the system |
| PASS | Level 1: every external flow joins an external entity and a process (no entity-to-entity or entity-to-store flows) |
| PASS | Level 1: every store flow joins a process and a data store and is labelled (no store-to-store flows) |
| PASS | Level 1: no black-hole (input-only) or miracle (output-only) processes |
| PASS | Level 1: every implemented or partial process keeps an input and an output when the planned flows are removed (7.0 is planned as a whole) |
| NOTE | D11 github_events: with planned flows removed it is never written by a process; today it is loaded by mongo/seed.js (initial data load, outside the DFD). The write S22 arrives with the webhook worker. |
| PASS | Level 1: every data store is both written and read (no write-only or read-only stores) |
| PASS | Naming: all 18 process names (Level 1 and Level 2) begin with an imperative verb from the controlled list (amend, answer, attach, build, capture, compile, compute, derive, file, form, lock, maintain, manage, record, remove, submit, withdraw) |
| PASS | Naming: none of the 217 flow labels begins with a process verb (lexical check; that every label is a noun phrase naming data was also reviewed by hand) |
| PASS | Balancing Level 0 / Level 1: every context flow decomposes into >= 1 Level 1 flow with the same entity and direction, every Level 1 external flow belongs to one context flow, and no context flow mixes planned and implemented components |
| PASS | Balancing 4.0: the Level 2 external flows are exactly the 7 Level 1 flows of 4.0 (split: F18 = F18.1 + F18.2 + F18.3; F21 = F21.1 + F21.2 + F21.4 + F21.3; F19 = F19.1 + F19.2; F20 = F20.1 + F20.2; F23 = F23.1 + F23.2; F50 = F50.1 + F50.2) |
| PASS | Balancing 4.0: Level 2 touches exactly the stores of 4.0 at Level 1 with the same access modes (D1 R, D2 R, D3 R, D4 R, D6 RW) |
| PASS | Level 2 of 4.0: every sub-process has at least one input and one output, and is numbered 4.1 to 4.5 |
| PASS | Balancing 5.0: the Level 2 external flows are exactly the 13 Level 1 flows of 5.0 (split: F29 = F29.1 + F29.2; F54 = F54.1 + F54.2) |
| PASS | Balancing 5.0: Level 2 touches exactly the stores of 5.0 at Level 1 with the same access modes (D1 R, D2 RW, D3 R, D4 RW, D5 RW, D6 R, D7 RA, D8 RW) |
| PASS | Level 2 of 5.0: every sub-process has at least one input and one output, and is numbered 5.1 to 5.5 |

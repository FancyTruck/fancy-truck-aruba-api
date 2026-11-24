# Evidence index

- `operational-verification-2026-10-22.json`: prior direct observations and owner reports, labelled separately; historical values are superseded by dated updates.
- `night-verification-2026-10-23.json`: fresh bounded readonly Render metadata/metrics/events/original backup logs; synthetic local code verification. No personal records, raw logs, provider object keys or private Sites source are included.
- Project association tests: `node --test test/projectAssociation.test.js test/intakeIntegration.test.js`; synthetic Odoo transport through the actual intake.
- Whole branch: `npm test`242/242. Local combined snapshot with upstream bb17921:261/261. `npm run check` plus `node --check src/projectAssociation.js` passed. These do not certify live acceptance.
- Owner-reported files listed in the prior handoff were not read in this checkout. Private Sites development tracks retain their own source/evidence; they are not copied to this public repository.

- Private proxy continuation: branch `work/fancy-proxy-reconcile-20261023`, commit2b25b2c;65 isolated combined tests, TypeScript/build passed. Public evidence contains only hashes and summaries; all private source stays in its private repository.
- Current MCP source4ea602f (metadata v21):26 tests, TypeScript/build passed; old validation helpers already present and byte-identical. No duplicate source patch.

- `night-verification-2026-10-24.json`:10 baseline failures reproduced;253 corrected branch and272 local upstream-combination tests passed, plus5syntax checks. Actual HTTP and filesystem failure injection; no live mutation. Readonly Render metrics/events are scoped separately.

- `night-verification-2026-10-25.json`: approval/audit single-save regression,5 baseline failures and1 existing pass;260 branch and279 local upstream-combination tests pass,5syntax checks. Actual HTTP and filesystem failure injection on synthetic action; zero external execution.

- `night-verification-2026-10-26.json`: lost-response recovery;5/7 new unit tests fail on baseline, all pass after patch.268 branch and297 local upstream-combination tests and5syntax checks pass; actual HTTP disconnect after commit and reopened-state checks use synthetic actions only.

- `night-verification-2026-10-27.json`: generic SMTP claim barrier. Six HTTP baseline scenarios fail and pass after correction;10 persistence/real-startup tests pass;285 branch/314 local upstream-combination tests and5syntax checks pass. Stub SMTP only; no real sends, live restart or new backup/memory acceptance.

- `night-verification-2026-10-28.json`: action queue/supersession atomicity.8 of9 new unit tests fail on baseline; all9 pass after correction, plus actual HTTP preparation failure/retry/replay.295 branch/324 local upstream-combination tests and5syntax checks pass. No real send/provider execution or new live acceptance.

- `night-verification-2026-10-29.json`: standalone audit and case rollback.8/9 baseline failures,9/9 corrected tests; actual mail/thread modules with synthetic post-effect audit failure retain replay barrier.304 branch/333 local combined tests and5syntax checks pass. Cases remain workflow simulation; no new live acceptance.

- `night-verification-2026-10-30.json`: bounded interactive MIME reader.6 unit+1 actual HTTP tests pass; HTTP regression fails on e443d86.311 branch/340 local upstream-combination tests and6syntax checks pass after reconstructing the missing ephemeral checkout. Full pre-edit server blob verified; no new OOM/live acceptance.

- `night-verification-2026-10-31.json`: real HTTP concurrency regression plus4 gate unit tests,316 branch tests/8syntax checks. Fresh-process actual-parser synthetic memory burst RSS262.5MiB baseline4 admitted vs124.9MiB gated1 admitted/3 rejected. PR38 combined suite BLOCKED by5 actual merge-tree conflicts; no new live OOM acceptance.

- `night-verification-2026-11-01.json`: five PR38 conflicts resolved in a current-main-based isolated source branch,357/357 synthetic tests and8syntax checks. Four new durable-review fault/reopen/replay tests; all PR38 outcome/watchdog/attention functionality retained. PR26 source preserved; no live acceptance or deployment.

- `night-verification-2026-11-02.json`: existing intake/watchdog now reports blocked generic SMTP. Four regressions fail on2fa25d2 and pass after correction; actual readonly HTTP verifies identical persisted bytes and zero provider calls.361 combined tests/9syntax checks, no live acceptance.

- `night-verification-2026-11-03.json`: canonical approval snapshot checked at reissue, confirmation/replay and execution.12 new baseline failures/1existing pass;13 corrected tests,374 total and9syntax checks. Real HTTP fails before SMTP construction/claim; synthetic only, server unchanged.

- `night-verification-2026-11-04.json`: failed cycle-startup recovery restores original held references without copying whole state.4 baseline failures/2existing passes;6 corrected regressions,380 total tests/9syntax checks. Synthetic filesystem/real-startup proofs, no live OOM/restart acceptance.

- `night-verification-2026-11-05.json`: native review closure binds displayed case/current interrupted operation;4 baseline HTTP subscenario failures,7 corrected Node tests,387 total/11syntax checks. Browser/mobile NOT EXECUTED; synthetic HTTP/store only, no providers.

- `night-verification-2026-11-06.json`: old RUNNING cycles survive state/backup retention.4 baseline failures/4 corrected passes,391 total tests/13syntax checks; actual encrypted synthetic isolated restore preserves pending/cursor/SMTP uncertainty and quarantine. No new real-provider backup proof.

- `night-verification-2026-11-07.json`: actual child-process ownership/SIGKILL tests;7 baseline failures,8 corrected tests,399 total/14syntax checks. SQLite local filesystem exclusion, canonical state/lock safety, readonly/restore and no uncertain replay. No Render disk/distributed-lock/live-checkpoint acceptance or real-provider backup proof.

- Same Nov7 report, second batch: readonly Peu/restore regressions reproduce4 failures on b017671;5 corrected tests and404 total/18syntax pass. Cache reads preserved, no observer ledger/schema recovery, sync/provider or scheduled backup effect; writable callbacks only instrumented, not run.

- Same Nov7 report, third batch:4 failures reproduced on75e23c7;4 corrected pending-diagnostic tests,408 total/19syntax. Older pending history cannot be hidden by a completed latest row; actual readonly HTTP and synthetic watchdog. No live checkpoint or side effect.

- `night-verification-2026-11-08.json`: real local HTTP + MIME parser + synthetic SQLite/stubbed IMAP shared attachment/message admission;1 baseline failure,409 total/19syntax pass. Abort/error cleanup, no provider or live OOM acceptance.

- `night-verification-2026-11-09.json`: attachment metadata/byte-limit gap reproduced on exact e1956ee (3/5 failures);5/5 after fix, actual HTTP/stubbed IMAP/real MIME,414/414 suite and20syntax checks. No provider/runtime mutation, live acceptance or new OOM/load/backup proof.

- `night-verification-2026-11-10.json`: execution result/audit atomic save and fault rollback;4 baseline failures,4 corrected passes,23 targeted/418 whole tests and20syntax checks. Actual Peu contract with synthetic SMTP preserves unknown retry barrier; no provider/live acceptance.

- `night-verification-2026-11-11.json`: explicit positive Peu verification and no pending SMTP before receipt;3 baseline failures/1pass,4 corrected passes,27 targeted/422 whole tests,20syntax checks. Synthetic providers; unknown replay barrier preserved; no live acceptance.

- `night-verification-2026-11-12.json`: admin readonly Peu ledger diagnostics, actual HTTP baseline fails,3 corrected/425 whole tests,21syntax checks. Real SQLite unchanged, zero providers; distinct requests/effects and explicit unavailable state; no live acceptance.

- `night-verification-2026-11-13.json`: cached public metadata budget before JS parse;2 baseline failures/1pass,3 corrected/10 targeted/428 whole tests,21syntax checks. Actual readonly100-row HTTP fixture/cache preserved, zero providers; no live OOM proof.

- `night-verification-2026-11-14.json`: Peu UID integrity/negative-size guard;3 baseline failures,3 corrected/10 targeted/431 whole tests,22syntax checks. Actual sync/SQLite synthetic IMAP preserves cursor/cache, corrected retry tested; no live acceptance.

- `night-verification-2026-11-15.json`: complete Peu flag snapshot staging/atomic application;2 baseline failures/3pass,5 corrected/15 targeted/436 whole tests,23syntax checks. Real SQLite/sync synthetic IMAP interruptions/transaction fault/retry; no live acceptance.

- 2026-11-16 — `night-verification-2026-11-16.json`: bounded final flag UID search/failed SEARCH cache preservation;12 new,31 targeted,448 whole tests,23syntax checks. Actual sync/SQLite with synthetic IMAP and installed compiler; no live acceptance.
- 2026-11-16 — `render-observation-2026-11-16.json`: independent readonly deployed-main samples and events; Nov13 exit1 cause unknown, no near-event log rows returned. No OOM/checkpoint acceptance or operational mutation.

- 2026-11-17 — `night-verification-2026-11-17.json`: bounded new-message UID acquisition;10 new/41 targeted/458 whole tests,23 syntax checks; actual sync/SQLite with synthetic IMAP, no live acceptance.

- 2026-11-17 — `commercial-direction-2026-11-17.json`: urgent readonly CRM diagnosis and main-based PR39 source correction;256 tests,7syntax checks; no operational acceptance.

- 2026-11-17 — PR39-only authorized release: `commercial-direction-2026-11-17.json` release section; main5bdde8, exact tested tree; Render live12:05:55UTC, publichealth200 and startup checks. No full commercial/notification acceptance.

- 2026-11-18: `night-verification-2026-11-18.json`; isolated continuation4a61f03/main24a8d6c reconciliation,499 synthetic/HTTP/SQLite tests and81syntax checks. Fresh readonly Render PR45 deploy metadata; no new live continuity/backup/OOM acceptance.

- 2026-11-19: `night-verification-2026-11-19.json`; isolated source bade6fb6491007abd96016f901a764f1fcacd35a/main d9216637348e122c5fd8332f4a30c2bc0c5b7460 reconciliation.573 synthetic/HTTP/SQLite tests,55 targeted and89syntax checks. Fresh readonly deploy/events metadata, no new memory or backup restore proof.

- 2026-11-20: `night-verification-2026-11-20.json`; source d5693a4e62949485d4e2f757c4cdc2f26220b513, mainf656112 reconciliation and bounded resumed commercial/sent UID pages.591 isolated tests/39targeted/93syntax;9new regressions. Fresh readonly Render deployment/events; first SINCE bootstrap remains unbounded, no new OOM/backup/live-checkpoint acceptance.

- 2026-11-21 — [Initial commercial date discovery](night-verification-2026-11-21.json): P00/P01/P03/P05/P22, IDs0.2/1.4/1.4.1/1.5/2.5/7.2/7.3. Actual pollMailbox/store with synthetic providers:11new,50targeted,611whole tests and84syntax checks; immutable initialSince, separate scan watermark, retries/reopens and snapshot arrivals. Source cbd40e9e0248decad5042502c4b83da0a4316450/tree19c4f909 verified in full after remote write. Independent existing Render main f36a109 live metadata/events read only; no new operational acceptance, OOM profile or backup restore.

- 2026-11-22 — [Bounded original lookup and sent helper identity](night-verification-2026-11-22.json): P01/P03/P05/P22, IDs1.4/1.4.1/1.5/2.5/7.2/7.3.12new/14targeted/623whole tests,85syntax checks; synthetic provider and actual service/SQLite/helper paths. Baseline sent helper falsely accepts multiple candidates without envelope verification; corrected conservative unique identity. Source3b9a380c74c99d0c58691d840c89e6c523d7f51c/treee57c6aec verified in full. Readonly latest Render deploy metadata only; no new operational acceptance/OOM/backup proof.

- 2026-11-23 — [Bounded team-reply discovery](night-verification-2026-11-23.json): P00/P01/P03/P05/P22, IDs0.2/1.4/1.4.1/1.5/2.5/7.2/7.3.12new/26targeted/639whole tests and86syntax checks; actual team module, synthetic providers. Work-limit/malformed/changed lookup refuses; current-main reply-cycle adapter reconciled with readonly guards. Full remote source c895a6d/tree8b42036e verified. Existing Render deploy metadata only; no release/operational acceptance/OOM/backup proof.

- 2026-11-24 — [Bounded generic mail listing](night-verification-2026-11-24.json): P01/P05/P22, IDs1.4/1.5/2.5/7.2/7.4.14new/14targeted/653whole tests and87syntax checks; real HTTP with synthetic IMAP, exact prior-tree HTTP regression fails. Explicit partial coverage/work cap, readonly cleanup and unchanged store verified. Source5c3c5c8/tree2187e1b fetched in full. Existing Render deploy metadata only; no live acceptance/OOM/backup proof.

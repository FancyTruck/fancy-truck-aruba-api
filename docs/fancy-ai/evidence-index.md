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

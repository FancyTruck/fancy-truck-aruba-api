# Autonomous development handoff
Date: 2026-10-22. Upstream baseline: 12c701351ce01144e93bb43b4f353b9fdbb0b6fd (PR25).
This is a development checkpoint, not operational acceptance.

## Implemented in this branch
- Bound source download in the actual business inbox/sent poller: validate size first, request at most 20 MiB + 1, refuse oversized returned content before parsing, preserve the last completed UID and expose an explicit suspension code.
- Diagnostic health does not report OK for failed, interrupted, suspended, stalled or not-yet-observed cycles. Process liveness remains HTTP 200.
- Backup logging distinguishes the explicit provider download/Class B cap response from generic AccessDenied without exposing raw provider messages.
- Updated the legacy PR24 test to PR25 metadata-only semantics; no policy of skipping business-request content was introduced.
- Full local suite: 217 tests passed, 0 failed. npm run check passed. Original baseline: 208 passed, 1 failed (outdated large-message test).
- These are local isolated tests, including existing actual-server tests with read-only startup. No production tests or writes performed.

## Next executable work
1. Reconcile this branch/PR and latest upstream before editing. Do not duplicate this patch.
2. Add actual-server integration coverage for degraded diagnostic states using a seeded synthetic state; review feedback from the bounded poller tests.
3. Inventory remaining runtime gaps against requirements.json, especially native quote/project dedup scope and workflow integration.
4. Continue independent development without waiting for production rollout or unavailable providers.

## Open acceptance and dependencies
- OOM mitigation remains under observation; do not declare stability or phases complete.
- Recent backup restore is not verified. Provider download cap was reported explicitly; do not raise free limits or guess reset time. Credentials are not stored here.
- Live checkpoint monotonicity, restart/replay recovery, notes, activities and commercial handoff need read-only operational evidence.
- Browser administrative policy block must not be bypassed.
- Fiscal source/migration, pipeline transitions and contract-specific deposit rules remain business dependencies; implement review paths rather than inventing decisions.
- Workflow class is not proven connected to the running service; its simulated tests do not establish invoices/payments/deposits as operational.
- F6 multiuser remains deferred by owner choice.

## Boundaries
No merge, main push, deploy, provider reconfiguration, production data mutation, mail send, fiscal issuance or refund. Main auto-deploys. Preserve secrets and personal data outside this public repository.
Use synthetic fixtures only. Any later run must inspect open PRs, branch state and currently running work before mutation.


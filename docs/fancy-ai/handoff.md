# Autonomous development handoff
Date: 2026-10-22. Upstream baseline: 12c701351ce01144e93bb43b4f353b9fdbb0b6fd (PR25).
This is a development checkpoint, not operational acceptance.

## Implemented in this branch
- Bound source download in the actual business inbox/sent poller: validate size first, request at most 20 MiB + 1, refuse oversized returned content before parsing, preserve the last completed UID and expose an explicit suspension code.
- Diagnostic health does not report OK for failed, interrupted, suspended, stalled or not-yet-observed cycles. Process liveness remains HTTP 200.
- Backup logging distinguishes the explicit provider download/Class B cap response from generic AccessDenied without exposing raw provider messages.
- Updated the legacy PR24 test to PR25 metadata-only semantics; no policy of skipping business-request content was introduced.
- Full local suite: 230 tests passed, 0 failed. npm run check passed. Original baseline: 208 passed, 1 failed (outdated large-message test).
- These are local isolated tests, including existing actual-server tests with read-only startup. No production tests or writes performed.

- Quote creation no longer treats any existing opportunity quote as a duplicate: exact customer/opportunity/source replay is reused; other scopes become persistent review without creating or overwriting a quote. Includes a real intake-path test with a mocked Odoo transport. Explicit draft API retains support for multiple source keys. Scope acceptance remains open.
- Draft PR: https://github.com/FancyTruck/fancy-truck-aruba-api/pull/26

- Added HTTP 413/5xx route-template, duration and RSS telemetry before the parser; excludes raw URLs, query strings, request content and credentials. Verified against a real local-server oversized request and seeded failed-cycle diagnostics.

## Next executable work
1. Reconcile this branch/PR and latest upstream before editing. Do not duplicate this patch.
2. Actual-server degraded diagnostics and oversized-body telemetry are covered. Continue source inventory and remaining functional gaps.
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


## Source inventory and independent development checkpoints
Source access is now working. The previous source-helper blocker is resolved.
- Sites Odoo MCP connector (observed live version 16): validates tool arguments and explicit finance residuals before proxy access, bounds request/response bytes, applies a proxy timeout and avoids automatic retries after uncertain writes. Development branch `work/fancy-mcp-validation-20261022`, commit `6407e68b8a5f6f2506dc115ab3baa758a5c3c87a`; 12 isolated tests, TypeScript and build passed.
- Sites contracts/reports app is also the actual Odoo proxy (observed live version 21). Development branch `work/fancy-finance-audit-20261022`, commit `51d43c7f227a5d2ca1981dafcd5a0712493e4901`; 29 isolated tests, TypeScript and build passed. Explicit finite cent-precision amounts and consistent residuals are required before financial internal-note operations. Phase-specific required report data, photo and both signatures are checked before browser PDF export/send. Signature presence is not legal or cryptographic validation. Live mobile acceptance is still open.
- The proxy finance action posts an internal CRM note only. It does not reconcile a ledger, register payments or advance the pipeline. No DKV/Telepass/cards/QUADRA/Carla implementation was found in the two inspected Sites sources; native Odoo and other components remain to inspect.
- No Sites main branch, publication or live version was changed. Never copy private Sites source, credentials, customer documents or logs into this public repository.

## Read-only case audit
PR26 adds admin-only `GET /v1/odoo/crm/leads/:id/audit`: exact-case notes, activities and quotations with counts, bounded samples and explicit unavailable/truncation markers. Reader tokens cannot use it. It makes no writes and never infers completed commercial handoff from the presence of a note or activity. All returned content remains untrusted. This technical admin role does not implement future per-user Odoo permissions.

## Next gaps requiring source work and evidence
1. Document list now accepts only exact sale.order-linked PDFs; filename/reference candidates produce review flags. Resolve Sign relational linkage and review flow; real mobile acceptance remains open.
2. Document upload/send replay and uncertain delivery need reconciliation. A successful Odoo message_post alone is not verified mail delivery.
3. Verify live cycles/checkpoints, restart recovery and backup restore within authorized access. Do not bypass administrative policy.
4. Reconcile invoice source, deposit conditions, pipeline and external integrations before activating business operations. Keep F0-F2 and all operational acceptance open.

## Report dispatch continuation
Development-only source now includes a D1 schema migration and atomic dispatch claim before any Odoo write. Exact payload/partner/recipient/order/phase matching, persistent uncertain states and exact-marker/attachment reconciliation prevent repeated writes for the same dispatch key. Client retries retain the original multipart request; a regenerated PDF with changed bytes becomes a conflict. Receipts report Odoo registration with delivery unverified. No hosted migration was applied.
Twenty-nine isolated tests passed in the private component, including SQL concurrency, temporary SQLite close/reopen, partial upload failures, post timeouts, failed persistence of a receipt, recipient/payload conflicts, ambiguous reconciliation and the actual route with mocked Odoo. TypeScript and build passed. These are not production acceptance.
Read-only status API and browser reference recovery are implemented with no D1/Odoo writes; exact order and phase checks are covered. Three additive schema migrations remain unapplied to hosted D1. Snapshot-bound confirmation of already proven registration is now implemented; partial/unproven outcomes still require review and cannot be forced. Next: cross-device discovery and unresolved partial-case handling, actual D1 migration/runtime validation under separately authorized rollout, real mobile document QA and verified delivery evidence. Do not create a new send key to bypass an uncertain dispatch. Hosted provider failures and full phase acceptance remain open.

## Reviewed registration and current bounded evidence
The private report branch adds a review endpoint/panel tied to exact case, phase, dispatch and evidence snapshot. Confirmation re-reads the Odoo message and exact PDF/photo metadata associated with the same order. Duplicate/relinked IDs, stale snapshots, unknown decisions and concurrent state changes are refused. It writes only a timestamped D1 verification receipt through compare-and-set, never an Odoo post, upload or economic action. Delivery remains unverified. Migration 0003 is additive and unapplied to hosted D1.
29 private-component tests, TypeScript and build passed; actual review routes use mocked Odoo and isolated SQLite. Browser/mobile and live migration acceptance remain open.
On 2026-10-22 authorized native Odoo connector health succeeded and a fleet list limited to one returned a vehicle record. This is genuine bounded read evidence, not a full fleet/maintenance/availability audit. No private vehicle record is copied here; no live record/message was changed.

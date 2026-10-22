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

## Operational verification and concurrent publication — 2026-10-22
Read operational-verification-2026-10-22.json before continuing. Render is now live on PR27 commit 5f8b02503e8366f1baf0b6bd6886a6dfd656a9ae. Private PR26 is unmerged and its older baseline must be reconciled with current main. Sites metadata independently confirms proxy v22 and OAuth connector v17; reconcile these sources with both private development branches before any release. Do not overwrite the new notes/activities implementation.
The owner reports native notes/activity pagination, note creation, activity create/update with expected revision, D1 replay/uncertain-state protection, 11 isolated tests and successful builds. Initial snapshot: real COLLAUDO creation/replay were owner-supplied and tools not yet loaded. This is superseded by the completed 4.5.1 acceptance below. Do not create replacements or close the test activity. Proxy typecheck reportedly retains 19 baseline errors; this differs from the earlier private branch's typecheck result. Do not conflate codebases or claim production typecheck passed.
Direct original runtime logs show a different 76318-byte format-2 operational backup completed capture/encrypt/upload/download/decrypt/extract/integrity/isolated restore at 00:29 UTC. Later logs reuse the verified result. This supersedes the blanket statement that no recent restore is evidenced, but no new restore or independent artifact reinspection was performed here. Retention/alarm criteria remain open.
Bounded live observations: 13 memory samples (142.8–149.7 MiB of512), 284 reported HTTP200 counts in the sampled hour; no server_failed/server_restarted events returned after PR24. Normal deploy replacement still occurred. 71 Peu Aruba sync events are evidence of sync execution, not commercial-cycle/checkpoint correctness. No matching commercial cycle/checkpoint log evidence was returned by the bounded search.
Existing test quote totals remain unchanged and draft. A matching project exists by name but sale_order_id=false, so native linkage is not established. No production writes, sends, provider changes or deployments were performed by this verification session. Full operational and end-to-end acceptance remain open.

## Acceptance 4.5.1 closed — 2026-10-22
The owner reports complete real note/activity read-update acceptance, replay duplicate:true, stale-revision rejection, restored original deadline and unchanged unrelated activity revision. This session independently read the target internal note, verified disjoint paginated note results, activity pagination, the open COLLAUDO activity with deadline 2026-10-23 and the other activity's unchanged revision. The reported local completed-test file is not present in this checkout; do not claim it was read.
Close only 4.5.1. Do not close/delete the COLLAUDO activity, create replacements or repeat already completed write tests. Full parent-phase, commercial handoff, economic and multiuser acceptance remain open.
An extra reversible-title test attempted by this session was rejected by automatic approval review under the existing no-production-write boundary; it was not executed, bypassed or retried. It is no longer necessary after the owner's completed test. Do not request approval or schedule a retry for that obsolete extra test.
A query-filtered project listing still returned INVALID_ARGUMENT, while unfiltered bounded listing succeeded. An initial activity read error did not recur on the exact same request. These are separate diagnostic observations, not failures of the now completed bounded notes/activity acceptance. Next inspect project filtering and exact order linkage, reconcile current source and obtain authorized cycle/checkpoint diagnostics.

## Owner commercial traceability update — 2026-10-22
The owner supplied a further readonly audit (reported local report outputs/commercial-traceability-audit-20261022.json; not read in this checkout). Test project15 for S00331 has sale_order_id=false, partner464 and one task. Do not invoke create_project_for_order to repair it: name+order matching may create a duplicate. Inspect exact relation and a duplicate-safe repair design first; production writes remain outside this update.
Catering and activation test CRM records have acquired-customer-reply and PRONTA_CONTROLLO_PIETRO notes, with zero open activities. This neither proves absent work nor excludes other queues; complete handoff is not demonstrated. Food test CRM has zero open activities and only an internal OdooBot note in the supplied reads; referral is not established. All four end-to-end paths remain open. Notes/activity API acceptance4.5.1 remains closed.
Backup restore and memory evidence are inherited from the earlier verification, not newly retested by this update. No Odoo write or send was invoked. Continue authorized continuity/recovery checks and release-state reconciliation without repeating closed tests.

A new direct release-state read during this registry update confirms PR26 is draft/unmerged and Render latest deploy remains dep-dbcvo5on74is73fnhc6g on PR27 commit5f8b02503e8366f1baf0b6bd6886a6dfd656a9ae. This release check is new; backup/memory observations above are not.

## S00331 existing-case linkage verified — owner update 2026-10-22
The owner verified project15 through UI reload and API: reinvoiced_sale_order_id=[331,S00331], one project and one task. Earlier sale_order_id=false observations remain historical but do not establish absence of another valid relation. Keep sale_order_id, reinvoiced_sale_order_id, sale_line_id and allow_billable distinct; do not substitute one for another in generic matching.
The UI Sales Order selection automatically confirmed the draft. The owner cancelled/restored order331 to draft and verified WH/OUT/00066 and WH/IN/00064 cancelled. Total2152.18 is unchanged. History and order date22October remain; do not describe this as an untouched-draft or side-effect-free test. Do not repeat the UI operation.
Proxyv23 publication, successful build and real relation read are owner-reported; this update did not re-execute them. Local report outputs/S00331-link-verification.json was not read in this checkout. Reconcile latest source before continuing development.
Do not invoke create_project_for_order to repair this case: its deduplication is unchanged. Existing-case linkage is verified; generic creation/replay, commercial handoff, continuity/recovery and parent phases remain open. No new production write, send or deploy was executed by this registry update.

## v23-based project deduplication development
Direct Sites metadata confirms proxyv23. Fresh source c784d9520e054357df8e28206f7e3ec8c36d1059 was opened in a separate checkout; older development tracks are preserved. New private branch work/fancy-project-dedup-20261022 commit e40affde4841d3667b93971a3c9ebcdb21e8a970 changes the actual project creation route: exact separate relation checks, verified sales-line order, single-project readonly reuse, ambiguity/customer/name collision review, no draft confirmation and new creation only through an explicitly writable direct order relation on a confirmed order. Existing persistent ledger reserves per order and blocks uncertain/concurrent retries. Reuse does not certify an economic task or full workflow.
21 isolated tests passed including11 existing notes/activity regressions, actual route authorization, actual SQLite ledger races/timeouts and synthetic Odoo cases. Build passed; normalized typecheck diagnostics remain the same19 baseline errors, so typecheck is not passing.
No production invocation of create_project_for_order, Odoo write, UI association, merge or publication was performed. Source is private; do not copy into this public repository. Cross-service races with the separate Render creator and generic lifecycle acceptance remain open. This patch is not live; do not claim the published deduplication was fixed. See private source docs/project-order-dedup.md.

## Critical PR26 source correction — 2026-10-22
The owner found literal tool-truncation text in PR26 server.js at ad56eb2, replacing intake handlers and causing a real syntax failure. It was not in main. The owner repaired ONLY server.js using main handlers while retaining awaiting_scope_review, commit f7be6305ffb6ba9f2504b40a2d19fad539e6e3be. This correction is mandatory: never restore pre-fix local copies or old tree objects.
This session fetched the corrected server from that exact commit, verified Git blob SHA a128e39a7685f5474967b4c6528f70e93583b902 before writing the local copy and ran npm run check: five syntax checks passed. Current PR metadata confirms f7be630 was its head before this documentation update. Any next documentation commit must descend from f7be630 and retain that exact server blob. The pending pre-fix documentation tree was discarded. Verify remote code blobs after source writes; tool output truncation must never be treated as source.
Owner evidence: main5f8b025 passed23 isolated resume/dedup tests; integrated main+correctedPR26 passed246/246 tests and5syntax checks. Full-history git merge-tree reported no conflicts; mergeable:false alone was not conflict evidence. Report outputs/continuity-audit-20261022.json and logcontinuity-pr26-tests.log were not read in this checkout. These are isolated proofs, not live checkpoint acceptance.
Workspace Fancy Truck was already confirmed in this conversation (tea-daa7c667bikc73fkk940). A direct Render get_service using that explicit workspaceId succeeded here; do not ask the user to confirm it again. A separate session's absent selected workspace is an access-context issue, not application continuity evidence. Live checkpoint/queue/recovery verification remains open. No merge/deploy/restart/Odoo write/send was performed. F0/F1/F2 remain open.

# Peu integration

`PEU_ACCESS_TOKEN` is a distinct service credential. It grants only the deployed
Peu catalog, command/status API, contacts search and Pietro INBOX read/cache
routes. It cannot access hello, administrative diagnostics, approval endpoints,
legacy send endpoints, automation runs or arbitrary Odoo methods.

Peu config: `FANCY_BASE_URL` points to this service, `FANCY_READ_TOKEN` contains
the dedicated credential (the variable name is retained for adapter compatibility).
`PEU_ARUBA_PIETRO_ENABLED=true` provisions Pietro INBOX once. Revoking its folder
grant is respected on subsequent restarts. Mail sync does not mark mail read.

## Exact operation workflow

1. Peu obtains `/v1/peu/capabilities`, prepares an intent and requests Pietro's
   exact-payload confirmation through its owner-authenticated workflow.
2. `crm.create`, `quote.prepare`, and `mail.prepare` only queue an exact action
   in Fancy. Their result explicitly says `awaiting_fancy_approval`.
3. Fancy's existing approver must issue `APPROVA <action_id>` and final
   confirmation. Peu's service token cannot do either. No synthetic approval.
4. Peu invokes `operation.execute` for CRM/drafts or `mail.send` for email,
   including `action_id` and the returned `payload_hash`, with a newly confirmed
   exact intent. The Fancy approval and unchanged payload are checked again.
5. SQLite on the persistent disk records both request and action identities
   before any external effect. Replays return the verified result; changed
   payloads fail. Unknown/interrupted effects never automatically retry, including
   under a different request key. They require manual outcome reconciliation.

Odoo writes reuse the existing business handlers and are reread by record ID
and idempotency marker. SMTP checks acceptance and rejection; acceptance is NOT
a claim of delivery to the recipient. CRM/draft preparation is not CRM creation.
The legacy executor cannot execute Peu actions outside the dedicated ledger.

The separate `peu-aruba.sqlite` file must be included in the backup/recovery
policy before relying on disaster recovery of these new ledgers. Restoring an
old snapshot requires reconciliation, never blind resubmission.

Tests use mock Odoo/SMTP/IMAP. Do not perform live send tests without specific
authorization for recipient and message.

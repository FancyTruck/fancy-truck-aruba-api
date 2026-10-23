# Evidence index

- `operational-verification-2026-10-22.json`: prior direct observations and owner reports, labelled separately; historical values are superseded by dated updates.
- `night-verification-2026-10-23.json`: fresh bounded readonly Render metadata/metrics/events/original backup logs; synthetic local code verification. No personal records, raw logs, provider object keys or private Sites source are included.
- Project association tests: `node --test test/projectAssociation.test.js test/intakeIntegration.test.js`; synthetic Odoo transport through the actual intake.
- Whole branch: `npm test`242/242. Local combined snapshot with upstream bb17921:261/261. `npm run check` plus `node --check src/projectAssociation.js` passed. These do not certify live acceptance.
- Owner-reported files listed in the prior handoff were not read in this checkout. Private Sites development tracks retain their own source/evidence; they are not copied to this public repository.

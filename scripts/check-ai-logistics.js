// Read-only provider probe: no application import, Odoo writes or email sends.
import assert from 'node:assert/strict';
import { extractLogisticsAddresses, prepareRentalLogistics } from '../src/aiLogistics.js';
const env = { ...process.env, AI_LOGISTICS_ENABLED: 'true' };
const partial = await extractLogisticsAddresses('Vorrei noleggiare un Airstream a Milano.', { env });
assert.equal(partial.delivery, null);
assert.equal(partial.collection, null);
console.log('OPENAI: città senza indirizzo non inventata');
const result = await prepareRentalLogistics('Consegna: Via XX Settembre 20, Genova. Ritiro allo stesso indirizzo della consegna.', { env });
console.log(JSON.stringify({ status: result.status, reason: result.reason, missing: result.missing, routes: result.routes, quantities: result.lines.map(line => line[2].product_uom_qty) }));
if (result.status !== 'ROUTED_FOR_REVIEW') process.exitCode = 2;

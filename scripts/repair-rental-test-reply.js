// One-off repair for the explicitly authorized October 21 test only.
// Never touches production state, other leads, sales orders, or SMTP.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { currentMessage } from '../src/commercialFilter.js';

const stateFile = '/var/data/fancy-collaudo-20261021.json';
const email = 'grafichefancytruck@gmail.com';
const subject = '[FANCY-AI-COLLAUDO-20261021 / NOLEGGIO] Richiesta noleggio Airstream';
const leadId = 503;
const marker = parsed => `[AUTO:mail-${crypto.createHash('sha256').update(parsed.messageId).digest('hex').slice(0,24)}]`;
const client = new ImapFlow({ host: process.env.ARUBA_IMAP_HOST || 'imaps.aruba.it',
  port: Number(process.env.ARUBA_IMAP_PORT || 993), secure: true, logger: false,
  auth: { user: process.env.HELLO_EMAIL, pass: process.env.HELLO_PASSWORD } });
let app;
process.umask(0o077);
try {
  assert.equal(process.env.HELLO_EMAIL, 'hello@fancytruck.it');
  assert(!fs.existsSync(`${stateFile}.repair-quoted.started`), 'Riparazione gia avviata: verificare prima di ripetere');
  const stateBytes = fs.readFileSync(stateFile);
  const initialActions = Object.values(JSON.parse(stateBytes).actions);
  assert.equal(initialActions.filter(a => a.status === 'EXECUTED').length, 4);
  const pending = initialActions.filter(a => a.status === 'PENDING_APPROVAL');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].case_id, 'odoo-lead-503');
  assert.equal(pending[0].target, email);
  await client.connect();
  await client.mailboxOpen('INBOX', { readOnly: true });
  const uids = await client.search({ from: email, subject }, { uid: true });
  const messages = [];
  for await (const message of client.fetch(uids, { source: true }, { uid: true })) {
    const parsed = await simpleParser(message.source);
    assert.equal(parsed.from.value[0].address.toLowerCase(), email);
    assert(parsed.messageId);
    messages.push({ parsed, uid: message.uid });
  }
  assert.equal(messages.length, 2, 'Attese la richiesta e una sola risposta');
  const first = messages.find(m => m.parsed.subject === subject && !m.parsed.inReplyTo);
  const reply = messages.find(m => m.parsed.subject === `Re: ${subject}` && m.parsed.inReplyTo);
  assert(first && reply);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, new URL(process.env.ODOO_URL).origin);
    const [model, method] = new URL(url).pathname.split('/').slice(-2);
    const body = JSON.parse(options.body);
    if (!['search_read', 'search_count'].includes(method)) {
      assert.equal(model, 'crm.lead');
      assert(['write', 'message_post'].includes(method));
      assert.deepEqual(body.ids, [leadId]);
      if (method === 'message_post') assert.equal(body.subtype_xmlid, 'mail.mt_note');
      else assert(Object.keys(body.vals).every(k => ['description', 'partner_id', 'stage_id'].includes(k)));
    }
    return originalFetch(url, options);
  };
  const api = async (method, body) => {
    const response = await fetch(`${process.env.ODOO_URL.replace(/\/$/, '')}/json/2/crm.lead/${method}`, {
      method: 'POST', headers: { authorization: `bearer ${process.env.ODOO_API_KEY}`,
        'x-odoo-database': process.env.ODOO_DB, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    assert(response.ok, `Odoo HTTP ${response.status}`);
    return response.json();
  };
  const leads = await api('search_read', { domain: [['id', '=', leadId]],
    fields: ['name', 'email_from', 'description', 'partner_id', 'stage_id'], limit: 1 });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, subject);
  assert.equal(leads[0].email_from, email);
  assert(leads[0].description.includes(marker(first.parsed)));
  assert(leads[0].description.includes(marker(reply.parsed)));
  const backup = `${stateFile}.repair-quoted.backup.json`;
  fs.writeFileSync(backup, JSON.stringify({ state: JSON.parse(stateBytes), lead: leads[0] }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(`${stateFile}.repair-quoted.started`, new Date().toISOString(), { flag: 'wx', mode: 0o600 });
  nodemailer.createTransport = () => { throw Error('SMTP bloccato nel collaudo'); };
  Object.assign(process.env, { HOST: '127.0.0.1', PORT: '0', STATE_FILE: stateFile,
    READ_ONLY: 'false', AUTOMATION_ENABLED: 'false', STARTUP_CHECKS: 'false', ODOO_PARTNER_AUTOCOMPLETE: 'false' });
  app = await import('../src/server.js');
  // Rebuild only this test history from the original mailbox evidence, then replay
  // the one reply once. The existing contact remains linked to this same lead.
  await api('write', { ids: [leadId], vals: {
    description: `Richiesta ricevuta via hello@fancytruck.it\n\n${currentMessage(first.parsed.text)}\n\n${marker(first.parsed)}` } });
  const result = await app.processQuoteRequest(reply.parsed, reply.uid, 'hello', String(client.mailbox.uidValidity));
  assert.equal(result.lead_id, leadId);
  assert.equal(result.missing.length, 6);
  for (const field of ['date di inizio', 'orari di inizio', 'personalizzazioni', 'attrezzature', 'allestimenti', 'richieste particolari']) {
    assert(result.missing.some(value => value.includes(field)), `Dato perso: ${field}`);
  }
  const actions = Object.values(app.store.state.actions);
  assert.equal(actions.filter(a => a.status === 'EXECUTED').length, 4);
  const newPending = actions.filter(a => a.status === 'PENDING_APPROVAL');
  assert.equal(newPending.length, 1);
  assert.equal(newPending[0].case_id, 'odoo-lead-503');
  assert.equal(app.store.action(pending[0].id).status, 'CANCELLED');
  const replay = await app.processQuoteRequest(reply.parsed, reply.uid, 'hello', String(client.mailbox.uidValidity));
  assert(replay.duplicate);
  console.log(JSON.stringify({ pratica: leadId, dati_mancanti: result.missing, bozza_corretta: newPending[0].id }));
  console.log('NOLEGGIO CORRETTO: 6 DATI MANCANTI; VECCHIA BOZZA ANNULLATA; INVII: 0');
} catch (error) {
  console.error('CONTROLLO INCOMPLETO, NON RIPETERE:', error.message);
  process.exitCode = 1;
} finally {
  await client.logout().catch(() => {});
  if (app) await new Promise(resolve => app.server.close(resolve));
}

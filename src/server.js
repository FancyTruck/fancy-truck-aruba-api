import crypto from 'node:crypto';
import express from 'express';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 3000);
const apiToken = process.env.API_TOKEN || '';

function accountConfig(accountName) {
  const key = String(accountName || '').toLowerCase();
  const accounts = {
    hello: { email: process.env.HELLO_EMAIL, password: process.env.HELLO_PASSWORD },
    pietro: { email: process.env.PIETRO_EMAIL, password: process.env.PIETRO_PASSWORD },
  };
  const selected = accounts[key];
  if (!selected?.email || !selected?.password) throw new Error(`Casella ${key || '(mancante)'} non configurata`);
  return selected;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireToken(req, res, next) {
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!apiToken || !safeEqual(supplied, apiToken)) return res.status(401).json({ ok: false, error: 'Non autorizzato' });
  next();
}

function imapClient(account) {
  return new ImapFlow({
    host: process.env.ARUBA_IMAP_HOST || 'imaps.aruba.it',
    port: Number(process.env.ARUBA_IMAP_PORT || 993),
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
  });
}

async function withImap(accountName, operation) {
  const client = imapClient(accountConfig(accountName));
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function addressList(value) {
  return value?.value?.map((item) => ({ name: item.name || null, address: item.address || null })) || [];
}

function odooConfig() {
  const url = String(process.env.ODOO_URL || '').replace(/\/$/, '');
  const db = process.env.ODOO_DB;
  const apiKey = process.env.ODOO_API_KEY;
  if (!url || !db || !apiKey) throw new Error('Configurazione Odoo incompleta');
  return { url, db, apiKey };
}

async function odooCall(model, method, args = [], kwargs = {}) {
  const config = odooConfig();
  let body;
  if (method === 'search_read' || method === 'search_count') {
    body = { domain: args[0] || [], ...kwargs };
  } else if (method === 'create') {
    body = { vals_list: args[0] || [], ...kwargs };
  } else if (method === 'message_post') {
    body = { ids: args[0] || [], ...kwargs };
  } else if (method === 'write') {
    body = { ids: args[0] || [], vals: args[1] || {}, ...kwargs };
  } else if (method === 'unlink') {
    body = { ids: args[0] || [], ...kwargs };
  } else {
    body = { args, kwargs };
  }
  const response = await fetch(`${config.url}/json/2/${model}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `bearer ${config.apiKey}`,
      'x-odoo-database': config.db,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Errore Odoo ${model}.${method} (${response.status})`);
  }
  return payload;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fancy-truck-aruba-api', configured: {
    hello: Boolean(process.env.HELLO_EMAIL && process.env.HELLO_PASSWORD),
    pietro: Boolean(process.env.PIETRO_EMAIL && process.env.PIETRO_PASSWORD),
  } });
});

app.use('/v1', requireToken);

app.get('/v1/accounts', (_req, res) => {
  res.json({ ok: true, accounts: [
    { id: 'hello', email: process.env.HELLO_EMAIL || null, configured: Boolean(process.env.HELLO_PASSWORD) },
    { id: 'pietro', email: process.env.PIETRO_EMAIL || null, configured: Boolean(process.env.PIETRO_PASSWORD) },
  ] });
});

app.get('/v1/odoo/health', async (_req, res) => {
  try {
    const stages = await odooCall('crm.stage', 'search_count', [[]]);
    res.json({ ok: true, service: 'odoo', crm_stages: stages });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.get('/v1/odoo/crm/stages', async (_req, res) => {
  try {
    const stages = await odooCall('crm.stage', 'search_read', [[]], {
      fields: ['name', 'sequence', 'fold'], order: 'sequence asc, id asc', limit: 100,
    });
    res.json({ ok: true, stages });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.get('/v1/odoo/contacts/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Parametro q obbligatorio' });
    const contacts = await odooCall('res.partner', 'search_read', [[
      '|', '|', '|', ['name', 'ilike', query], ['email', 'ilike', query], ['phone', 'ilike', query], ['vat', 'ilike', query],
    ]], { fields: ['name', 'email', 'phone', 'mobile', 'vat', 'company_type'], limit: 20 });
    res.json({ ok: true, contacts });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.get('/v1/odoo/products/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Parametro q obbligatorio' });
    const products = await odooCall('product.product', 'search_read', [[
      '|', ['name', 'ilike', query], ['default_code', 'ilike', query],
    ]], { fields: ['name', 'default_code', 'list_price', 'uom_id', 'sale_ok', 'rent_ok'], limit: 30 });
    res.json({ ok: true, products });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.post('/v1/odoo/contacts', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name obbligatorio' });
    const values = {
      name, company_type: req.body?.company_type === 'person' ? 'person' : 'company',
      email: req.body?.email || false, phone: req.body?.phone || false, mobile: req.body?.mobile || false,
      vat: req.body?.vat || false, street: req.body?.street || false, zip: req.body?.zip || false,
      city: req.body?.city || false,
      l10n_it_codice_fiscale: req.body?.fiscal_code || false,
      l10n_it_pa_index: req.body?.sdi_code || false,
      l10n_it_pec_email: req.body?.pec || false,
    };
    const duplicateDomain = [];
    if (values.email) duplicateDomain.push(['email', '=ilike', values.email]);
    if (values.vat) duplicateDomain.push(['vat', '=ilike', values.vat]);
    if (duplicateDomain.length) {
      const domain = duplicateDomain.length === 2 ? ['|', ...duplicateDomain] : duplicateDomain;
      const existing = await odooCall('res.partner', 'search_read', [domain], { fields: ['name', 'email', 'vat'], limit: 5 });
      if (existing.length) return res.status(409).json({ ok: false, duplicate: true, existing });
    }
    const id = await odooCall('res.partner', 'create', [[values]]);
    res.status(201).json({ ok: true, id: Array.isArray(id) ? id[0] : id });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.post('/v1/odoo/crm/leads', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const idempotencyKey = String(req.body?.idempotency_key || '').trim();
    if (!name || !idempotencyKey) return res.status(400).json({ ok: false, error: 'name e idempotency_key obbligatori' });
    const marker = `[AUTO:${idempotencyKey}]`;
    const existing = await odooCall('crm.lead', 'search_read', [[['description', 'ilike', marker]]], {
      fields: ['name', 'partner_id', 'stage_id'], limit: 1,
    });
    if (existing.length) return res.json({ ok: true, duplicate: true, lead: existing[0] });
    const values = {
      name, type: 'opportunity', partner_id: req.body?.partner_id || false,
      contact_name: req.body?.contact_name || false, email_from: req.body?.email_from || false,
      phone: req.body?.phone || false,
      description: `${req.body?.description || ''}\n\n${marker}`.trim(),
    };
    const id = await odooCall('crm.lead', 'create', [[values]]);
    res.status(201).json({ ok: true, id: Array.isArray(id) ? id[0] : id });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.post('/v1/odoo/sales/drafts', async (req, res) => {
  try {
    const partnerId = Number(req.body?.partner_id);
    const idempotencyKey = String(req.body?.idempotency_key || '').trim();
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!Number.isInteger(partnerId) || !idempotencyKey) {
      return res.status(400).json({ ok: false, error: 'partner_id e idempotency_key obbligatori' });
    }
    const marker = `AUTO:${idempotencyKey}`;
    const existing = await odooCall('sale.order', 'search_read', [[['client_order_ref', '=', marker]]], {
      fields: ['name', 'state', 'partner_id', 'opportunity_id', 'amount_total', 'is_rental_order'], limit: 1,
    });
    if (existing.length) return res.json({ ok: true, duplicate: true, order: existing[0] });

    const isRental = req.body?.order_type === 'rental';
    if (isRental && (!req.body?.rental_start_date || !req.body?.rental_return_date)) {
      return res.status(400).json({ ok: false, error: 'Per il noleggio servono rental_start_date e rental_return_date' });
    }
    const orderLines = lines.map((line) => {
      const displayType = ['line_section', 'line_note'].includes(line?.display_type) ? line.display_type : false;
      const values = displayType ? {
        display_type: displayType, name: String(line?.name || '').trim(),
      } : {
        product_id: Number(line?.product_id) || false,
        name: String(line?.name || '').trim(),
        product_uom_qty: Number(line?.quantity ?? 1),
        price_unit: Number(line?.price_unit ?? 0),
        discount: Number(line?.discount ?? 0),
      };
      if (!values.name) throw new Error('Ogni riga deve avere una descrizione');
      return [0, 0, values];
    });
    const values = {
      partner_id: partnerId,
      opportunity_id: Number(req.body?.opportunity_id) || false,
      client_order_ref: marker,
      origin: req.body?.origin || false,
      note: req.body?.note || false,
      validity_date: req.body?.validity_date || false,
      is_rental_order: isRental,
      rental_start_date: isRental ? req.body.rental_start_date : false,
      rental_return_date: isRental ? req.body.rental_return_date : false,
      order_line: orderLines,
    };
    const id = await odooCall('sale.order', 'create', [[values]]);
    const orderId = Array.isArray(id) ? id[0] : id;
    const order = await odooCall('sale.order', 'search_read', [[['id', '=', orderId]]], {
      fields: ['name', 'state', 'partner_id', 'opportunity_id', 'amount_total', 'is_rental_order'], limit: 1,
    });
    res.status(201).json({ ok: true, id: orderId, order: order[0] || null });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.post('/v1/odoo/chatter', async (req, res) => {
  try {
    const model = String(req.body?.model || '').trim();
    const resId = Number(req.body?.res_id);
    const body = String(req.body?.body || '').trim();
    if (!model || !Number.isInteger(resId) || !body) {
      return res.status(400).json({ ok: false, error: 'model, res_id e body sono obbligatori' });
    }
    const id = await odooCall(model, 'message_post', [[resId]], { body, message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
    res.status(201).json({ ok: true, id });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore Odoo' });
  }
});

app.get('/v1/:account/status', async (req, res) => {
  try {
    const result = await withImap(req.params.account, async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        return { email: accountConfig(req.params.account).email, exists: client.mailbox.exists, uidNext: client.mailbox.uidNext };
      } finally { lock.release(); }
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore IMAP' });
  }
});

app.get('/v1/:account/messages', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const unseenOnly = String(req.query.unseen || 'false') === 'true';
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  try {
    const messages = await withImap(req.params.account, async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const search = {};
        if (unseenOnly) search.seen = false;
        if (since && !Number.isNaN(since.getTime())) search.since = since;
        const uids = await client.search(search, { uid: true });
        const selected = uids.slice(-limit).reverse();
        const rows = [];
        for (const uid of selected) {
          const message = await client.fetchOne(uid, { envelope: true, flags: true, internalDate: true, size: true }, { uid: true });
          rows.push({ uid, subject: message.envelope?.subject || null, date: message.envelope?.date || message.internalDate || null,
            from: message.envelope?.from || [], to: message.envelope?.to || [], flags: [...(message.flags || [])], size: message.size || null });
        }
        return rows;
      } finally { lock.release(); }
    });
    res.json({ ok: true, account: req.params.account, count: messages.length, messages });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore IMAP' });
  }
});

app.get('/v1/:account/messages/:uid', async (req, res) => {
  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ ok: false, error: 'UID non valido' });
  try {
    const parsed = await withImap(req.params.account, async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const raw = await client.download(uid, undefined, { uid: true });
        return simpleParser(raw.content);
      } finally { lock.release(); }
    });
    res.json({ ok: true, message: {
      uid, messageId: parsed.messageId || null, subject: parsed.subject || null, date: parsed.date || null,
      from: addressList(parsed.from), to: addressList(parsed.to), cc: addressList(parsed.cc),
      text: parsed.text || null, html: typeof parsed.html === 'string' ? parsed.html : null,
      attachments: parsed.attachments.map((item, index) => ({ index, filename: item.filename || null, contentType: item.contentType,
        size: item.size, checksum: item.checksum || null })),
    } });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore IMAP' });
  }
});

app.post('/v1/:account/send', async (req, res) => {
  try {
    const account = accountConfig(req.params.account);
    const transporter = nodemailer.createTransport({
      host: process.env.ARUBA_SMTP_HOST || 'smtps.aruba.it', port: Number(process.env.ARUBA_SMTP_PORT || 465), secure: true,
      auth: { user: account.email, pass: account.password },
    });
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!to || !subject || !text) return res.status(400).json({ ok: false, error: 'to, subject e text sono obbligatori' });
    const info = await transporter.sendMail({ from: `Fancy Truck <${account.email}>`, to, cc: req.body?.cc || undefined,
      replyTo: account.email, subject, text });
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Errore SMTP' });
  }
});

async function verifyAccountConnections(accountName) {
  const account = accountConfig(accountName);
  const imap = new ImapFlow({
    host: process.env.ARUBA_IMAP_HOST || 'imaps.aruba.it',
    port: Number(process.env.ARUBA_IMAP_PORT || 993),
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
  });

  try {
    await imap.connect();
    console.log(`IMAP ${accountName}: OK`);
    await imap.logout();
  } catch (error) {
    console.error(`IMAP ${accountName}: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
  }

  const smtp = nodemailer.createTransport({
    host: process.env.ARUBA_SMTP_HOST || 'smtps.aruba.it',
    port: Number(process.env.ARUBA_SMTP_PORT || 465),
    secure: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user: account.email, pass: account.password },
  });

  try {
    await smtp.verify();
    console.log(`SMTP ${accountName}: OK`);
  } catch (error) {
    console.error(`SMTP ${accountName}: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
  } finally {
    smtp.close();
  }
}

app.listen(port, () => {
  console.log(`Fancy Truck Aruba API in ascolto sulla porta ${port}`);
  Promise.allSettled(['hello', 'pietro'].map(verifyAccountConnections)).catch(() => {});
  odooCall('crm.stage', 'search_count', [[]])
    .then((count) => console.log(`ODOO CRM: OK (${count} fasi)`))
    .catch((error) => console.error(`ODOO CRM: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`));
  odooCall('ir.model.fields', 'search_read', [[
    ['model', 'in', ['res.partner', 'crm.lead', 'sale.order', 'sale.order.line']],
    ['name', 'in', ['l10n_it_codice_fiscale', 'l10n_it_pa_index', 'l10n_it_pec_email',
      'opportunity_id', 'is_rental_order', 'rental_start_date', 'rental_return_date', 'order_line']],
  ]], { fields: ['model', 'name'], limit: 50 })
    .then((fields) => console.log(`ODOO FLUSSO PREVENTIVI: OK (${fields.map((field) => `${field.model}.${field.name}`).join(', ')})`))
    .catch((error) => console.error(`ODOO FLUSSO PREVENTIVI: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`));
});

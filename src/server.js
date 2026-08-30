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
});

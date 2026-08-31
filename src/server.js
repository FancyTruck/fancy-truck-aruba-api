import crypto from 'node:crypto';
import express from 'express';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { JsonStateStore } from './store.js';
import { ApprovalService, withinOperatingWindow } from './policy.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 3000);
const apiToken = process.env.API_TOKEN || '';
const startedAt = Date.now();
const store = new JsonStateStore();
const approvals = new ApprovalService(store);

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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function plainTextFromHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function quoteRequestKind(subject, text) {
  const value = `${subject || ''}\n${text || ''}`.toLowerCase();
  const requestWords = ['preventiv', 'quotazione', 'disponibil', 'noleggi', 'roadtour', 'road tour',
    'brand activation', 'personalizz', 'food truck', 'foodtruck', 'pop up truck', 'truck', 'trasporto', 'logistica'];
  if (!requestWords.some((word) => value.includes(word))) return null;
  if (['noleggi', 'disponibil', 'food truck', 'foodtruck', 'veicolo'].some((word) => value.includes(word))) return 'rental';
  if (['roadtour', 'road tour', 'brand activation', 'campagna', 'evento'].some((word) => value.includes(word))) return 'sale';
  return 'unknown';
}

function emailMarker(parsed, uid) {
  const source = parsed.messageId || `${uid}:${parsed.date?.toISOString() || ''}:${parsed.subject || ''}`;
  return `mail-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function missingRequestDetails(kind, subject, text) {
  const value = `${subject || ''}\n${text || ''}`;
  const lower = value.toLowerCase();
  const dates = value.match(/\b(?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:20)?\d{2}\b/g) || [];
  const times = value.match(/\b(?:[01]?\d|2[0-3])[:.]\d{2}\b/g) || [];
  const vehicleWords = ['ape', 'airstream', 'fiat 238', 'citroen', 'hy', 'horse trailer', 'schoolbus', 'school bus', 'vw t1', 'framo', 'truck'];
  const hasVehicle = vehicleWords.some((word) => lower.includes(word));
  const hasLocation = /\b(?:luogo|location|destinazione|presso|indirizzo|città|comune)\b/i.test(value);
  const missing = [];
  if (!hasVehicle) missing.push(kind === 'sale' ? 'mezzo o struttura richiesta' : 'veicolo richiesto');
  if (dates.length < 2) missing.push('data di inizio e data di fine');
  if (times.length < 2) missing.push('orario di consegna/inizio e orario di ritiro/fine');
  if (!hasLocation) missing.push('luogo completo dell’attività o della consegna');
  if (kind === 'sale' && !/programma|tappa|attività|attivita|roadtour|road tour/i.test(value)) missing.push('programma operativo o tappe previste');
  return missing;
}

function normalizedSubject(value) {
  return String(value || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim().toLowerCase();
}

function extractCustomerData(text) {
  const value = String(text || '');
  const vat = value.match(/(?:p\.?\s*iva|partita\s+iva)\s*[:\-]?\s*(?:it\s*)?(\d{11})/i)?.[1] || null;
  const fiscalCode = value.match(/(?:c\.?\s*f\.?|codice\s+fiscale)\s*[:\-]?\s*([A-Z0-9]{11,16})/i)?.[1]?.toUpperCase() || null;
  const sdi = value.match(/(?:sdi|codice\s+destinatario)\s*[:\-]?\s*([A-Z0-9]{7})/i)?.[1]?.toUpperCase() || null;
  const pec = value.match(/(?:pec)\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() || null;
  const phone = value.match(/(?:tel(?:efono)?|cell(?:ulare)?)\s*[:\-]?\s*(\+?\d[\d .()\/-]{6,}\d)/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  return { vat, fiscalCode, sdi, pec, phone };
}

function italianDateTimeValues(text) {
  const value = String(text || '');
  const dateMatches = [...value.matchAll(/\b(0?[1-9]|[12]\d|3[01])[\/.\-](0?[1-9]|1[0-2])[\/.\-]((?:20)?\d{2})\b/g)];
  const timeMatches = [...value.matchAll(/\b([01]?\d|2[0-3])[:.](\d{2})\b/g)];
  if (dateMatches.length < 2 || timeMatches.length < 2) return null;
  const compose = (dateMatch, timeMatch) => {
    const year = String(dateMatch[3]).length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
    return `${year}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')} ${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}:00`;
  };
  return { start: compose(dateMatches[0], timeMatches[0]), end: compose(dateMatches[1], timeMatches[1]) };
}

function vehicleSearchTerm(text) {
  const value = String(text || '').toLowerCase();
  const known = [
    ['horse trailer', 'Horse Trailer'], ['school bus', 'School Bus'], ['schoolbus', 'School Bus'],
    ['fiat 238', 'Fiat 238'], ['vw t1', 'VW T1'], ['airstream', 'Airstream'], ['citroen hy', 'Citroen HY'],
    ['citroën hy', 'Citroen HY'], ['framo', 'Framo'], ['ape', 'Ape'],
  ];
  return known.find(([needle]) => value.includes(needle))?.[1] || null;
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

async function findOrCreatePartnerFromEmail(parsed) {
  const sender = parsed.from?.value?.[0];
  const email = String(sender?.address || '').trim().toLowerCase();
  if (!email) throw new Error('Mittente senza indirizzo e-mail');
  const existing = await odooCall('res.partner', 'search_read', [[['email', '=ilike', email]]], {
    fields: ['name', 'email', 'phone', 'vat', 'l10n_it_codice_fiscale', 'l10n_it_pa_index', 'l10n_it_pec_email'], limit: 5,
  });
  if (existing.length) return { partner: existing[0], created: false };
  const ids = await odooCall('res.partner', 'create', [[{
    name: String(sender?.name || email).trim(), company_type: 'person', email,
  }]]);
  const id = Array.isArray(ids) ? ids[0] : ids;
  return { partner: { id, name: sender?.name || email, email, vat: false }, created: true };
}

async function updatePartnerFromText(partner, text) {
  const extracted = extractCustomerData(text);
  const values = {};
  if (!partner.vat && extracted.vat) values.vat = extracted.vat;
  if (!partner.l10n_it_codice_fiscale && extracted.fiscalCode) values.l10n_it_codice_fiscale = extracted.fiscalCode;
  if (!partner.l10n_it_pa_index && extracted.sdi) values.l10n_it_pa_index = extracted.sdi;
  if (!partner.l10n_it_pec_email && extracted.pec) values.l10n_it_pec_email = extracted.pec;
  if (!partner.phone && !partner.mobile && extracted.phone) values.phone = extracted.phone;
  if (Object.keys(values).length) await odooCall('res.partner', 'write', [[partner.id], values]);
  return { ...partner, ...values };
}

function missingFiscalDetails(partner) {
  const missing = [];
  if (!partner.vat && !partner.l10n_it_codice_fiscale) missing.push('partita IVA o codice fiscale');
  if (!partner.l10n_it_pa_index) missing.push('codice SDI');
  if (!partner.l10n_it_pec_email) missing.push('PEC');
  if (!partner.phone && !partner.mobile) missing.push('telefono di contatto');
  return missing;
}

async function askCustomerForMissingDetails(leadId, partner, senderName, missing) {
  if (!missing.length) return;
  const items = missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const body = `<p>Buongiorno${senderName ? ` ${escapeHtml(senderName)}` : ''},</p><p>grazie per le informazioni. Per completare il preventivo ci servono ancora:</p><ul>${items}</ul><p>Può rispondere direttamente a questa e-mail; aggiorneremo la stessa richiesta senza creare duplicati.</p><p>Grazie,<br>Fancy Truck</p>`;
  await odooCall('crm.lead', 'message_post', [[leadId]], {
    body: `<p><strong>BOZZA NON INVIATA — approvazione di Pietro necessaria</strong></p>${body}`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });
  return approvals.queue({
    type: 'SEND_EMAIL', target: partner.email, case_id: `odoo-lead-${leadId}`,
    idempotency_key: `missing-details:${leadId}:${missing.slice().sort().join(',')}`,
    payload: { account: 'hello', subject: 'Informazioni necessarie per preparare il preventivo Fancy Truck', html: body },
  }).action;
}

async function quotationTemplate(kind) {
  const names = kind === 'rental'
    ? ['Noleggio Fancy Truck', 'Noleggio']
    : ['Brand Activation', 'Roadtour', 'Vendite Fancy Truck'];
  try {
    for (const name of names) {
      const templates = await odooCall('sale.order.template', 'search_read', [[['name', 'ilike', name]]], {
        fields: ['name', 'note', 'payment_term_id'], limit: 5,
      });
      if (templates.length === 1) return templates[0];
    }
  } catch (error) {
    console.error(`MODELLO PREVENTIVO: controllo non completato - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
  }
  return null;
}

async function rentalAvailability(productId, dates) {
  if (!productId || !dates) return { checked: false, conflicts: [] };
  try {
    const conflicts = await odooCall('sale.order', 'search_read', [[
      ['state', '!=', 'cancel'], ['is_rental_order', '=', true],
      ['rental_start_date', '<', dates.end], ['rental_return_date', '>', dates.start],
      ['order_line.product_id', '=', productId],
    ]], {
      fields: ['name', 'state', 'partner_id', 'rental_start_date', 'rental_return_date'],
      order: 'rental_start_date asc', limit: 50,
    });
    return { checked: true, conflicts };
  } catch (error) {
    console.error(`DISPONIBILITÀ NOLEGGIO: controllo non completato - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
    return { checked: false, conflicts: [] };
  }
}

async function createReviewActivity(lead, order, reviewItems) {
  try {
    const login = String(process.env.ODOO_LOGIN || '').trim();
    let users = login ? await odooCall('res.users', 'search_read', [[['login', '=ilike', login]]], {
      fields: ['name', 'login'], limit: 1,
    }) : [];
    if (!users.length) users = await odooCall('res.users', 'search_read', [[['name', 'ilike', 'Pietro']]], {
      fields: ['name', 'login'], limit: 5,
    });
    const models = await odooCall('ir.model', 'search_read', [[['model', '=', 'crm.lead']]], { fields: ['model'], limit: 1 });
    const types = await odooCall('mail.activity.type', 'search_read', [[]], { fields: ['name'], order: 'sequence asc, id asc', limit: 1 });
    if (!users.length || !models.length || !types.length) throw new Error('utente, modello o tipo attività non disponibile');
    const summary = `Controllare bozza ${order.name || order.id}`;
    const existing = await odooCall('mail.activity', 'search_count', [[
      ['res_model', '=', 'crm.lead'], ['res_id', '=', lead.id], ['summary', '=', summary],
    ]]);
    if (existing) return;
    const baseUrl = odooConfig().url;
    await odooCall('mail.activity', 'create', [[{
      activity_type_id: types[0].id, res_model_id: models[0].id, res_id: lead.id,
      user_id: users[0].id, summary,
      note: `<p>Bozza pronta per il controllo finale: <a href="${baseUrl}/odoo/crm/${lead.id}">${escapeHtml(order.name || String(order.id))}</a></p><ul>${reviewItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
      date_deadline: new Date().toISOString().slice(0, 10),
    }]]);
  } catch (error) {
    await odooCall('crm.lead', 'message_post', [[lead.id]], {
      body: `Avviso automatico non creato come attività: ${escapeHtml(error instanceof Error ? error.message : 'errore sconosciuto')}. La bozza resta segnalata nel chatter.`,
      message_type: 'comment', subtype_xmlid: 'mail.mt_note',
    });
  }
}

async function createEconomicProject(lead, order, partner) {
  const projectName = `${order.name || order.id} — ${lead.name}`.slice(0, 240);
  const existing = await odooCall('project.project', 'search_read', [[['name', '=', projectName]]], {
    fields: ['name'], limit: 1,
  });
  let projectId = existing[0]?.id;
  if (!projectId) {
    const fields = await odooCall('ir.model.fields', 'search_read', [[
      ['model', '=', 'project.project'], ['name', 'in', ['partner_id', 'sale_order_id']],
    ]], { fields: ['name'], limit: 10 });
    const available = new Set(fields.map((field) => field.name));
    const values = { name: projectName };
    if (available.has('partner_id')) values.partner_id = partner.id;
    if (available.has('sale_order_id')) values.sale_order_id = order.id;
    const ids = await odooCall('project.project', 'create', [[values]]);
    projectId = Array.isArray(ids) ? ids[0] : ids;
  }
  const tasks = await odooCall('project.task', 'search_read', [[
    ['project_id', '=', projectId], ['name', '=', '00 – RIEPILOGO ECONOMICO'],
  ]], { fields: ['name'], limit: 1 });
  if (!tasks.length) {
    await odooCall('project.task', 'create', [[{
      project_id: projectId, name: '00 – RIEPILOGO ECONOMICO', partner_id: partner.id,
      description: `<p>Riepilogo economico collegato alla bozza ${escapeHtml(order.name || String(order.id))}. Sostituire le stime con i costi effettivi senza sommarli due volte.</p>`,
    }]]);
  }
  return { id: projectId, name: projectName };
}

async function createDraftFromCrmLead(lead, partner, kind, combinedText, key) {
  const existing = await odooCall('sale.order', 'search_read', [[['opportunity_id', '=', lead.id]]], {
    fields: ['name', 'state', 'opportunity_id', 'is_rental_order'], limit: 1,
  });
  if (existing.length) return { order: existing[0], duplicate: true };

  const dates = italianDateTimeValues(combinedText);
  const isRental = kind === 'rental';
  const vehicle = vehicleSearchTerm(combinedText);
  const template = await quotationTemplate(kind);
  let product = null;
  if (vehicle) {
    const products = await odooCall('product.product', 'search_read', [[['name', 'ilike', vehicle]]], {
      fields: ['name', 'list_price', 'sale_ok', 'rent_ok'], limit: 20,
    });
    const eligible = products.filter((item) => item.sale_ok && (!isRental || item.rent_ok));
    if (eligible.length === 1) product = eligible[0];
  }

  const availability = isRental ? await rentalAvailability(product?.id, dates) : { checked: false, conflicts: [] };

  const line = product
    ? [0, 0, { product_id: product.id, name: product.name, product_uom_qty: 1, price_unit: product.list_price }]
    : [0, 0, { display_type: 'line_note', name: `Richiesta cliente da completare commercialmente: ${String(combinedText).slice(0, 3000)}` }];
  const values = {
    partner_id: partner.id, opportunity_id: lead.id, client_order_ref: `AUTO:${key}`,
    origin: lead.name, is_rental_order: isRental, order_line: [line],
  };
  if (template) {
    values.sale_order_template_id = template.id;
    if (template.note) values.note = template.note;
    if (Array.isArray(template.payment_term_id)) values.payment_term_id = template.payment_term_id[0];
  }
  if (isRental && dates) {
    values.rental_start_date = dates.start;
    values.rental_return_date = dates.end;
  }
  const ids = await odooCall('sale.order', 'create', [[values]]);
  const orderId = Array.isArray(ids) ? ids[0] : ids;
  const order = await odooCall('sale.order', 'search_read', [[['id', '=', orderId]]], {
    fields: ['name', 'state', 'opportunity_id', 'is_rental_order', 'amount_total'], limit: 1,
  });
  const reviewItems = [];
  reviewItems.push(template ? `Modello applicato: ${template.name}` : 'Modello di preventivo da verificare');
  reviewItems.push(product ? `Prodotto e listino riconosciuti: ${product.name} — euro ${Number(product.list_price || 0).toFixed(2)}` : 'Prodotto e prezzo da selezionare');
  if (isRental) {
    reviewItems.push(dates ? `Periodo: ${dates.start} — ${dates.end}` : 'Periodo da verificare');
    if (!availability.checked) reviewItems.push('Disponibilità non verificabile senza prodotto e periodo certi');
    else if (availability.conflicts.length) reviewItems.push(`ATTENZIONE: ${availability.conflicts.length} possibile sovrapposizione (${availability.conflicts.map((item) => item.name).join(', ')})`);
    else reviewItems.push('Disponibilità: nessuna sovrapposizione rilevata nei noleggi Odoo');
    reviewItems.push('Cauzione, tariffa per la durata e condizioni di pagamento da confermare nel controllo finale');
  } else {
    reviewItems.push('Programma, servizi, logistica, personalizzazione e condizioni economiche da confermare');
  }
  await odooCall('crm.lead', 'message_post', [[lead.id]], {
    body: `<p>Bozza ${isRental ? 'Noleggi' : 'Vendite'} <strong>${escapeHtml(order[0]?.name || orderId)}</strong> generata dalla presente opportunità CRM.</p><ul>${reviewItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>La bozza non è stata inviata al cliente.</p>`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });
  await createReviewActivity(lead, order[0] || { id: orderId }, reviewItems);
  const economicProject = await createEconomicProject(lead, order[0] || { id: orderId, name: String(orderId) }, partner);
  await odooCall('crm.lead', 'message_post', [[lead.id]], {
    body: `<p>Creato progetto economico <strong>${escapeHtml(economicProject.name)}</strong> con un solo lavoro <strong>00 – RIEPILOGO ECONOMICO</strong>.</p>`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });
  return { order: order[0] || { id: orderId }, project: economicProject, duplicate: false };
}

async function findReplyLead(senderEmail, subject) {
  const partners = await odooCall('res.partner', 'search_read', [[
    ['email', '=ilike', senderEmail],
  ]], { fields: ['id'], limit: 50 });
  const partnerIds = partners.map((partner) => partner.id);
  const senderDomain = partnerIds.length
    ? ['|', ['email_from', '=ilike', senderEmail], ['partner_id', 'in', partnerIds]]
    : [['email_from', '=ilike', senderEmail]];
  const leads = await odooCall('crm.lead', 'search_read', [[
    ['type', '=', 'opportunity'], ['active', '=', true], ...senderDomain,
  ]], { fields: ['name', 'description', 'partner_id', 'stage_id', 'create_date'], order: 'create_date desc', limit: 20 });
  const normalized = normalizedSubject(subject);
  const matched = leads.filter((lead) => {
    const leadSubject = normalizedSubject(lead.name);
    return normalized && leadSubject && (normalized.includes(leadSubject) || leadSubject.includes(normalized));
  });
  if (matched.length === 1) return matched[0];
  return leads.length ? leads[0] : null;
}

async function processQuoteReply(parsed, uid, lead) {
  const sender = parsed.from?.value?.[0];
  const key = emailMarker(parsed, uid);
  const marker = `[AUTO:${key}]`;
  if (String(lead.description || '').includes(marker)) return { skipped: true, duplicate: true, lead_id: lead.id };

  const partnerId = Array.isArray(lead.partner_id) ? lead.partner_id[0] : lead.partner_id;
  const partners = await odooCall('res.partner', 'search_read', [[['id', '=', partnerId]]], {
    fields: ['name', 'email', 'phone', 'vat', 'l10n_it_codice_fiscale', 'l10n_it_pa_index', 'l10n_it_pec_email'], limit: 1,
  });
  if (!partners.length) throw new Error(`Contatto Odoo non trovato per opportunità ${lead.id}`);
  let partner = await updatePartnerFromText(partners[0], parsed.text);
  const replyText = String(parsed.text || '').trim().slice(0, 12000);
  const combinedText = `${lead.description || ''}\n\nRisposta cliente:\n${replyText}\n\n${marker}`;
  await odooCall('crm.lead', 'write', [[lead.id], { description: combinedText }]);
  await odooCall('crm.lead', 'message_post', [[lead.id]], {
    body: `<p><strong>Risposta cliente acquisita automaticamente</strong></p><p>${escapeHtml(replyText).replace(/\n/g, '<br>')}</p>`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });

  const kind = quoteRequestKind(lead.name, combinedText) || 'unknown';
  const missing = [...missingRequestDetails(kind, lead.name, combinedText), ...missingFiscalDetails(partner)];
  if (missing.length) {
    await askCustomerForMissingDetails(lead.id, partner, sender?.name, missing);
    return { lead_id: lead.id, reply: true, missing };
  }
  const draft = await createDraftFromCrmLead(lead, partner, kind, combinedText, key);
  return { lead_id: lead.id, reply: true, order_id: draft.order?.id, ready_for_review: true };
}

async function processQuoteRequest(parsed, uid) {
  const sender = parsed.from?.value?.[0];
  const senderEmail = String(sender?.address || '').trim().toLowerCase();
  if (!senderEmail || senderEmail.endsWith('@fancytruck.it') || /no-?reply|mailer-daemon/.test(senderEmail)) {
    return { skipped: true, reason: 'mittente interno o automatico' };
  }
  const replyLead = await findReplyLead(senderEmail, parsed.subject);
  if (/^\s*(re|r|fw|fwd)\s*:/i.test(String(parsed.subject || '')) && replyLead) {
    return processQuoteReply(parsed, uid, replyLead);
  }

  const kind = quoteRequestKind(parsed.subject, parsed.text);
  if (!kind) return { skipped: true, reason: 'non commerciale' };

  const key = emailMarker(parsed, uid);
  const marker = `[AUTO:${key}]`;
  const existingLead = await odooCall('crm.lead', 'search_read', [[['description', 'ilike', marker]]], {
    fields: ['name', 'partner_id', 'stage_id'], limit: 1,
  });
  if (existingLead.length) return { skipped: true, duplicate: true, lead_id: existingLead[0].id };

  const found = await findOrCreatePartnerFromEmail(parsed);
  const created = found.created;
  const partner = await updatePartnerFromText(found.partner, parsed.text);
  const cleanBody = String(parsed.text || '').trim().slice(0, 12000);
  const leadIds = await odooCall('crm.lead', 'create', [[{
    name: String(parsed.subject || `Richiesta da ${sender?.name || senderEmail}`).slice(0, 240),
    type: 'opportunity', partner_id: partner.id, contact_name: sender?.name || false,
    email_from: senderEmail, description: `Richiesta ricevuta via hello@fancytruck.it\n\n${cleanBody}\n\n${marker}`,
  }]]);
  const leadId = Array.isArray(leadIds) ? leadIds[0] : leadIds;

  const missingFiscal = missingFiscalDetails(partner);
  const missingOperational = missingRequestDetails(kind, parsed.subject, parsed.text);
  const operationalNote = kind === 'rental'
    ? 'Richiesta classificata come possibile noleggio: prima della bozza Noleggi verificare veicolo, date, orari, luogo, personalizzazione e logistica.'
    : kind === 'sale'
      ? 'Richiesta classificata come Vendite/brand activation o roadtour.'
      : 'Tipologia commerciale da verificare prima di generare il preventivo.';
  await odooCall('crm.lead', 'message_post', [[leadId]], {
    body: `${operationalNote}${missingFiscal.length ? `<br>Dati anagrafici da integrare: ${missingFiscal.join(', ')}.` : ''}${missingOperational.length ? `<br>Dati operativi da integrare: ${missingOperational.join(', ')}.` : ''}`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });

  const missingForCustomer = [...missingOperational, ...missingFiscal];
  if (missingForCustomer.length) {
    await askCustomerForMissingDetails(leadId, partner, sender?.name, missingForCustomer);
    return { lead_id: leadId, partner_id: partner.id, partner_created: created, order_id: null, kind, missing: missingForCustomer };
  }

  const lead = { id: leadId, name: String(parsed.subject || `Richiesta da ${sender?.name || senderEmail}`), description: cleanBody };
  const draft = await createDraftFromCrmLead(lead, partner, kind, cleanBody, key);
  return { lead_id: leadId, partner_id: partner.id, partner_created: created, order_id: draft.order?.id, kind, ready_for_review: true };
}

async function pollQuoteRequests(accountName) {
  const results = await withImap(accountName, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      const rows = [];
      for (const uid of uids.slice(-100)) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message?.source) continue;
        const parsed = await simpleParser(message.source);
        rows.push(await processQuoteRequest(parsed, uid));
      }
      return rows;
    } finally { lock.release(); }
  });
  const created = results.filter((row) => row.lead_id && !row.duplicate);
  console.log(`RICHIESTE ${accountName.toUpperCase()}: controllo completato, ${results.length} messaggi recenti, ${created.length} nuove lead elaborate`);
  return created;
}

async function runOperationalCycle({ force = false } = {}) {
  if (!force && !withinOperatingWindow()) return { skipped: true, reason: 'fuori fascia 08:00-19:59 Europe/Rome' };
  const cycle = store.beginCycle(['aruba:hello', 'aruba:pietro', 'odoo:crm']);
  const summary = { read: 0, created: 0, updated: 0, duplicates: 0, suspended: 0, failed: 0, errors: [] };
  for (const source of ['hello', 'pietro']) {
    try {
      const rows = await pollQuoteRequests(source);
      summary.read += rows.length;
      summary.created += rows.filter((row) => row.lead_id).length;
      store.integration(`aruba:${source}`, { status: 'OK', last_success_at: new Date().toISOString(), error: null });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(`${source}: ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
      store.integration(`aruba:${source}`, { status: 'CONTROLLO NON COMPLETATO', error: summary.errors.at(-1) });
    }
  }
  try {
    const replies = await pollOdooLeadReplies();
    summary.read += replies.length;
    summary.updated += replies.filter((row) => row.reply).length;
    store.integration('odoo:crm', { status: 'OK', last_success_at: new Date().toISOString(), error: null });
  } catch (error) {
    summary.failed += 1;
    summary.errors.push(`odoo: ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
    store.integration('odoo:crm', { status: 'CONTROLLO NON COMPLETATO', error: summary.errors.at(-1) });
  }
  return store.finishCycle(cycle.id, summary);
}

async function pollOdooLeadReplies() {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const messages = await odooCall('mail.message', 'search_read', [[
    ['model', '=', 'crm.lead'], ['message_type', '=', 'email'], ['date', '>=', since],
  ]], {
    fields: ['res_id', 'subject', 'body', 'email_from', 'author_id', 'date', 'message_id'],
    order: 'date asc, id asc', limit: 100,
  });
  const results = [];
  for (const message of messages) {
    const emailMatch = String(message.email_from || '').match(/<([^>]+)>/) || String(message.email_from || '').match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    const senderEmail = String(emailMatch?.[1] || '').trim().toLowerCase();
    if (!senderEmail || senderEmail.endsWith('@fancytruck.it')) continue;
    const leads = await odooCall('crm.lead', 'search_read', [[['id', '=', message.res_id]]], {
      fields: ['name', 'description', 'partner_id', 'stage_id', 'create_date'], limit: 1,
    });
    if (!leads.length) continue;
    const authorName = Array.isArray(message.author_id) ? message.author_id[1] : null;
    const parsed = {
      messageId: message.message_id || `odoo-mail-message-${message.id}`,
      subject: message.subject || leads[0].name,
      date: message.date ? new Date(String(message.date).replace(' ', 'T') + 'Z') : new Date(),
      text: plainTextFromHtml(message.body),
      from: { value: [{ name: authorName, address: senderEmail }] },
    };
    results.push(await processQuoteReply(parsed, `odoo-${message.id}`, leads[0]));
  }
  const processed = results.filter((row) => row.reply && !row.duplicate);
  console.log(`RISPOSTE ODOO CRM: controllo completato, ${messages.length} messaggi recenti, ${processed.length} risposte elaborate`);
  return processed;
}

app.get('/health', (_req, res) => {
  const snapshot = store.snapshot();
  const lastCycle = snapshot.cycles.at(-1) || null;
  const operatingNow = withinOperatingWindow();
  const stale = operatingNow && (lastCycle?.ended_at
    ? Date.now() - new Date(lastCycle.ended_at).getTime() > 2 * 60 * 60 * 1000
    : Date.now() - startedAt > 10 * 60 * 1000);
  res.status(stale ? 503 : 200).json({ ok: !stale, service: 'fancy-truck-aruba-api', procedure_version: '2026-08-30',
    operating_window: '08:00-19:59 Europe/Rome', state_file: store.filePath, last_cycle: lastCycle,
    pending_approvals: Object.values(snapshot.actions).filter((item) => !['EXECUTED', 'CANCELLED'].includes(item.status)).length,
    configured: {
    hello: Boolean(process.env.HELLO_EMAIL && process.env.HELLO_PASSWORD),
    pietro: Boolean(process.env.PIETRO_EMAIL && process.env.PIETRO_PASSWORD),
    odoo: Boolean(process.env.ODOO_URL && process.env.ODOO_DB && process.env.ODOO_API_KEY),
    gmail_double_check: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN),
    sistemi_cloud: Boolean(process.env.SISTEMI_API_URL && process.env.SISTEMI_API_TOKEN),
    bank: Boolean(process.env.BANK_API_URL && process.env.BANK_API_TOKEN),
  } });
});

app.use('/v1', requireToken);

app.get('/v1/automation/status', (_req, res) => {
  const snapshot = store.snapshot();
  res.json({ ok: true, integrations: snapshot.integrations, last_cycle: snapshot.cycles.at(-1) || null,
    actions: Object.values(snapshot.actions).map(({ confirmation_digest: _hidden, ...item }) => item) });
});

app.post('/v1/automation/run', async (req, res) => {
  try { res.json({ ok: true, cycle: await runOperationalCycle({ force: req.body?.force === true }) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Errore ciclo' }); }
});

app.post('/v1/approvals/:id/command', (req, res) => {
  try { res.json({ ok: true, ...approvals.approveCommand(req.params.id, req.body?.actor, req.body?.command) }); }
  catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'Errore approvazione' }); }
});

app.post('/v1/approvals/:id/confirm', (req, res) => {
  try { res.json({ ok: true, action: approvals.confirm(req.params.id, req.body?.actor, req.body?.confirmation_token) }); }
  catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'Errore conferma' }); }
});

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
    ]], { fields: ['name', 'email', 'phone', 'vat', 'company_type'], limit: 20 });
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
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!to || !subject || !text) return res.status(400).json({ ok: false, error: 'to, subject e text sono obbligatori' });
    const type = String(req.body?.action_type || 'SEND_EMAIL');
    const queued = approvals.queue({ type, target: to,
      idempotency_key: String(req.body?.idempotency_key || `email:${req.params.account}:${to}:${subject}`).trim(),
      payload: { account: req.params.account, to, cc: req.body?.cc || null, subject, text },
    });
    res.status(202).json({ ok: true, sent: false, duplicate: queued.duplicate, action: queued.action,
      message: 'Azione accodata: servono comando specifico di Pietro e conferma finale.' });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Errore accodamento' });
  }
});

app.post('/v1/actions/:id/execute', async (req, res) => {
  try {
    const action = approvals.assertExecutable(req.params.id);
    if (!['SEND_EMAIL', 'SEND_FOLLOW_UP', 'SEND_PAYMENT_REMINDER', 'SEND_QUOTE', 'SEND_CONTRACT', 'SEND_INVOICE'].includes(action.type)) {
      return res.status(409).json({ ok: false, error: 'Questa azione richiede un connettore specifico e non può essere eseguita via SMTP generico' });
    }
    const payload = action.payload || {};
    if (!payload.to && !action.target) throw new Error('Destinatario mancante');
    if (!payload.subject || (!payload.text && !payload.html)) throw new Error('Contenuto non completo: esecuzione bloccata');
    const account = accountConfig(payload.account || 'hello');
    const transporter = nodemailer.createTransport({
      host: process.env.ARUBA_SMTP_HOST || 'smtps.aruba.it', port: Number(process.env.ARUBA_SMTP_PORT || 465), secure: true,
      auth: { user: account.email, pass: account.password },
    });
    const info = await transporter.sendMail({ from: `Fancy Truck <${account.email}>`, to: payload.to || action.target,
      cc: payload.cc || undefined, replyTo: account.email, subject: payload.subject, text: payload.text || undefined,
      html: payload.html || undefined });
    res.json({ ok: true, action: approvals.executed(action.id, { message_id: info.messageId, accepted: info.accepted, rejected: info.rejected }) });
  } catch (error) {
    res.status(409).json({ ok: false, error: error instanceof Error ? error.message : 'Esecuzione bloccata' });
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
  setTimeout(() => runOperationalCycle().catch((error) => console.error(`CICLO OPERATIVO: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`)), 15000);
  setInterval(() => runOperationalCycle().catch((error) => console.error(`CICLO OPERATIVO: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`)), 60 * 60 * 1000);
});

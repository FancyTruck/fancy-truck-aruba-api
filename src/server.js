import { matchQuotationThread } from './threadReferences.js';
import { linkThreadMessage } from './threadLinking.js';
import { pollSentMailbox } from './sentTracking.js';
import { reconcileCrm } from './crmReconciliation.js';
import { buildBriefing } from './briefing.js';
import { runExternalBackup } from './externalBackup.js';
import { depositAmount, rentalTerms, PAYMENT_TERM_NAME } from './commercialTerms.js';
import { prepareRentalLogistics } from './aiLogistics.js';
import { logisticsDistancesFromRoutes } from './logisticsRoutes.js';
import { italianRentalDates } from './rentalDates.js';
import { standardLogisticsLines } from './standardLogistics.js';
import { classifyRentalBookings, unavailableVehicleAction } from './rentalAvailability.js';
import { accessControl } from './accessControl.js';
import { VERIFIED_ODOO_MODELS } from './verifiedOdooModels.js';
import { selectExactProduct, draftProductLine } from './productSelection.js';
import { catalogueModelsIn } from './vehicleCatalogue.js';
import { missingRequestDetails, requiredRequestDetails, REQUEST_CATEGORIES } from './requestDetails.js';
import { fileURLToPath } from 'node:url';
import { pollOdooMessages } from './odooPolling.js';
import { runMailOperation } from './mailOperations.js';
import { quotationPricelist, procedureStage } from './commercialSafeguards.js';
import { pollMailbox } from './mailPolling.js';
import crypto from 'node:crypto';
import express from 'express';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { classifyCommercialMessage, currentMessage } from './commercialFilter.js';
import { routeCommercialMessage } from './commercialRouting.js';
import { runtimeConfig, assertWritable, assertOdooMethod, readOnlyMiddleware } from './runtime.js';
import { JsonStateStore } from './store.js';
import { ApprovalService, withinOperatingWindow } from './policy.js';
import { isValidItalianFiscalCode, isValidItalianVat } from './italianFiscal.js';
import { explicitCompanyName, partnerValuesFromAutocomplete, selectCertainAutocompleteResult } from './partnerEnrichment.js';
import { contactPhoneValue, hasPartnerPhone, ODOO_PARTNER_FIELDS } from './odooPartnerSchema.js';
import {
  COMMERCIAL_PROCEDURE, COMMERCIAL_PROCEDURE_VERSION, PIETRO_FINAL_CHECKS,
  emailDomain, normalizeCommercialSubject, normalizeCompanyName,
} from './commercialProcedure.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 3000);
const apiToken = process.env.API_TOKEN || '';
const runtime = runtimeConfig();
const startedAt = Date.now();
const store = new JsonStateStore(runtime.stateFile);
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

const requireToken = accessControl(process.env);

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
  return classifyCommercialMessage(subject, text).kind;
}

function emailMarker(parsed, uid) {
  const source = parsed.messageId || `${uid}:${parsed.date?.toISOString() || ''}:${parsed.subject || ''}`;
  return `mail-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}


function extractCustomerData(text) {
  const value = String(text || '');
  const rawVat = value.match(/(?:p\.?\s*iva|partita\s+iva)\s*[:\-]?\s*(?:it\s*)?(\d{11})/i)?.[1] || null;
  const rawFiscalCode = value.match(/(?:c\.?\s*f\.?|codice\s+fiscale)\s*[:\-]?\s*([A-Z0-9]{11,16})/i)?.[1]?.toUpperCase() || null;
  const vat = rawVat && isValidItalianVat(rawVat) ? rawVat : null;
  const fiscalCode = rawFiscalCode && isValidItalianFiscalCode(rawFiscalCode) ? rawFiscalCode : null;
  const issues = [];
  if (rawVat && !vat) issues.push('partita IVA non valida');
  if (rawFiscalCode && !fiscalCode) issues.push('codice fiscale non valido');
  const sdi = value.match(/(?:sdi|codice\s+destinatario)\s*[:\-]?\s*([A-Z0-9]{7})/i)?.[1]?.toUpperCase() || null;
  const pec = value.match(/(?:pec)\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() || null;
  const phone = value.match(/(?:tel(?:efono)?|cell(?:ulare)?)\s*[:\-]?\s*(\+?\d[\d .()\/-]{6,}\d)/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  return { vat, fiscalCode, sdi, pec, phone, issues };
}


function vehicleSearchTerm(text) {
  const value = String(text || '').toLowerCase();
  const known = [
    ['horse trailer', 'Horse Trailer'], ['school bus', 'School Bus'], ['schoolbus', 'School Bus'],
    ['fiat 238', 'Fiat 238'], ['vw t1', 'VW T1'], ['airstream', 'Airstream'], ['citroen hy', 'Citroen HY'],
    ['citroën hy', 'Citroen HY'], ['framo', 'Framo'], ['ape', 'Ape'],
  ];
  const models = catalogueModelsIn(text);
  if (models.length > 1) return null;
  if (models[0] === 'Horse Trailer Vintage') return models[0];
  if (/\bhorse trailer legno\b/i.test(text)) return 'Horse Trailer Legno';
  return known.find(([needle]) => value.includes(needle))?.[1] || models[0] || null;
}

function odooConfig() {
  const url = String(process.env.ODOO_URL || '').replace(/\/$/, '');
  const db = process.env.ODOO_DB;
  const apiKey = process.env.ODOO_API_KEY;
  if (!url || !db || !apiKey) throw new Error('Configurazione Odoo incompleta');
  return { url, db, apiKey };
}

async function odooCall(model, method, args = [], kwargs = {}) {
  assertOdooMethod(runtime, method);
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
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `Errore Odoo ${model}.${method} (${response.status})`);
    error.status = response.status;
    const retryAfter = response.headers.get('retry-after');
    error.retryAfterMs = retryAfter == null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
    throw error;
  }
  return payload;
}

async function findOrCreatePartnerFromEmail(parsed) {
  const sender = parsed.from?.value?.[0];
  const email = String(sender?.address || '').trim().toLowerCase();
  if (!email) throw new Error('Mittente senza indirizzo e-mail');
  const text = String(parsed.text || '');
  const extracted = extractCustomerData(text);
  const companyName = explicitCompanyName(text);
  const fields = ODOO_PARTNER_FIELDS;
  const byEmail = await odooCall('res.partner', 'search_read', [[['email', '=ilike', email]]], {
    fields, limit: 10,
  });
  if (byEmail.length === 1) return { partner: byEmail[0], created: false, matched_by: 'email' };
  if (byEmail.length > 1) throw new Error(`Possibile anagrafica duplicata: ${byEmail.length} contatti usano ${email}`);

  if (extracted.vat) {
    const byVat = await odooCall('res.partner', 'search_read', [[['vat', '=ilike', extracted.vat]]], { fields, limit: 10 });
    if (byVat.length === 1) return { partner: byVat[0], created: false, matched_by: 'vat' };
    if (byVat.length > 1) throw new Error(`Possibile anagrafica duplicata: ${byVat.length} record usano la partita IVA ${extracted.vat}`);
  }

  if (companyName) {
    const candidates = await odooCall('res.partner', 'search_read', [[['name', 'ilike', companyName]]], { fields, limit: 20 });
    const normalized = normalizeCompanyName(companyName);
    const exact = candidates.filter((item) => normalizeCompanyName(item.name) === normalized);
    const sameDomain = candidates.filter((item) => emailDomain(item.email) && emailDomain(item.email) === emailDomain(email));
    const matches = exact.length ? exact : sameDomain;
    if (matches.length === 1) return { partner: matches[0], created: false, matched_by: exact.length ? 'company_name' : 'company_domain' };
    if (matches.length > 1) throw new Error(`Possibile anagrafica duplicata: ragione sociale ${companyName} non univoca`);
  }

  if (!companyName && !extracted.vat) {
    return { partner: null, created: false, identification_missing: true, email };
  }

  const ids = await odooCall('res.partner', 'create', [[{
    name: String(companyName || sender?.name || email).trim(), company_type: 'company', email,
    vat: extracted.vat || false,
  }]]);
  const id = Array.isArray(ids) ? ids[0] : ids;
  store.audit('ODOO_PARTNER_CREATED', { partner_id: id, email_domain: emailDomain(email), identified_by: extracted.vat ? 'vat' : 'company_name' });
  return { partner: { id, name: companyName || sender?.name || email, company_type: 'company', email, vat: extracted.vat || false }, created: true };
}

async function updatePartnerFromText(partner, text) {
  const extracted = extractCustomerData(text);
  const values = {};
  if (!partner.vat && extracted.vat) values.vat = extracted.vat;
  if (!partner.l10n_it_codice_fiscale && extracted.fiscalCode) values.l10n_it_codice_fiscale = extracted.fiscalCode;
  if (!partner.l10n_it_pa_index && extracted.sdi) values.l10n_it_pa_index = extracted.sdi;
  if (!partner.l10n_it_pec_email && extracted.pec) values.l10n_it_pec_email = extracted.pec;
  if (!hasPartnerPhone(partner) && extracted.phone) values.phone = extracted.phone;
  const companyName = explicitCompanyName(text);
  const issues = [...extracted.issues];
  const shouldEnrich = process.env.ODOO_PARTNER_AUTOCOMPLETE !== 'false'
    && (extracted.vat || companyName)
    && (!partner.street || !partner.zip || !partner.city || !partner.vat);
  if (shouldEnrich) {
    const lookupType = extracted.vat ? 'vat' : 'name';
    const lookupValue = extracted.vat || companyName;
    const lookupKey = `odoo-partner-autocomplete:${partner.id}:${lookupType}:${String(lookupValue).toUpperCase()}`;
    const remembered = store.has(lookupKey) ? store.remember(lookupKey) : null;
    if (remembered) {
      issues.push(...(remembered.result?.issues || []));
    } else {
      try {
        const candidates = extracted.vat
          ? await odooCall('res.partner', 'autocomplete_by_vat', [extracted.vat, false])
          : await odooCall('res.partner', 'autocomplete_by_name', [companyName, false]);
        const certain = selectCertainAutocompleteResult(candidates, { vat: extracted.vat, companyName });
        if (certain) Object.assign(values, partnerValuesFromAutocomplete(certain, { ...partner, ...values }));
        else issues.push('autocompletamento Odoo senza corrispondenza univoca');
        store.remember(lookupKey, { matched: Boolean(certain), issues: certain ? [] : ['autocompletamento Odoo senza corrispondenza univoca'] });
        store.audit('ODOO_PARTNER_AUTOCOMPLETE', { partner_id: partner.id, lookup_type: lookupType, matched: Boolean(certain) });
      } catch (error) {
        const reason = `autocompletamento Odoo non disponibile: ${error instanceof Error ? error.message : 'errore sconosciuto'}`;
        issues.push(reason);
        store.remember(lookupKey, { matched: false, issues: [reason] });
      }
    }
  }
  if (Object.keys(values).length) await odooCall('res.partner', 'write', [[partner.id], values]);
  return { ...partner, ...values, _dataIssues: issues };
}

function missingFiscalDetails(partner) {
  const missing = [];
  if (!partner.vat && !partner.l10n_it_codice_fiscale) {
    if (partner._dataIssues?.includes('codice fiscale non valido')) missing.push('codice fiscale valido (quello indicato non supera i controlli formali)');
    else if (partner._dataIssues?.includes('partita IVA non valida')) missing.push('partita IVA valida (quella indicata non supera i controlli formali)');
    else missing.push('partita IVA o codice fiscale');
  }
  if (!partner.l10n_it_pa_index) missing.push('codice SDI');
  if (!partner.l10n_it_pec_email) missing.push('PEC');
  if (!hasPartnerPhone(partner)) missing.push('telefono di contatto');
  return missing;
}

function customerReplyHeaders(parsed, fallback) {
  const subject = String(parsed?.subject || fallback).replace(/[\r\n]/g, ' ');
  return { subject: /^\s*(?:re|r)\s*:/i.test(subject) ? subject : `Re: ${subject}`,
    inReplyTo: parsed?.messageId || undefined, references: parsed?.messageId || undefined };
}

async function queueStreetfoodHandoff(leadId, recipient, parsed) {
  const contact = REQUEST_CATEGORIES.event_food.contact;
  const action = approvals.queue({ type: 'SEND_EMAIL', target: recipient,
    case_id: `odoo-lead-${leadId}`, idempotency_key: `streetfood-handoff:${leadId}`,
    payload: { account: 'hello', ...customerReplyHeaders(parsed, 'La sua richiesta per un evento food'),
      html: `<p>Buongiorno, per la partecipazione a eventi food il suo riferimento è Cristiano, commerciale della nostra divisione streetfood: <a href="mailto:${contact}">${contact}</a>.</p><p>Grazie,<br>Fancy AI · Fancy Truck</p>` },
  }).action;
  return { lead_id: leadId, kind: 'event_food', handoff_contact: contact, approval_id: action.id };
}

async function askCustomerForMissingDetails(leadId, partner, senderName, missing, newRequest = null) {
  if (!missing.length) return;
  const items = missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const body = `<p>Buongiorno${senderName ? ` ${escapeHtml(senderName)}` : ''},</p><p>sono Fancy AI, il bot di Fancy Truck. Aiuto il team a raccogliere le informazioni necessarie per preparare il suo preventivo.</p><p>Grazie per la richiesta. Ci mancano queste informazioni:</p><ul>${items}</ul><p>Può rispondere direttamente a questa e-mail. Se qualche dettaglio è ancora da definire, ce lo segnali. Se preferisce parlare con una persona, lo scriva nella risposta.</p><p>Il preventivo sarà verificato dal team prima dell’invio.</p><p>Grazie,<br>Fancy AI<br>Bot di Fancy Truck</p>`;
  await odooCall('crm.lead', 'message_post', [[leadId]], {
    body: `<p><strong>BOZZA NON INVIATA — approvazione di Pietro necessaria</strong></p>${body}`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });
  return approvals.queue({
    type: 'SEND_EMAIL', target: partner.email, case_id: `odoo-lead-${leadId}`,
    idempotency_key: `missing-details:${leadId}:${missing.slice().sort().join(',')}`,
    supersede_group: `missing-details:odoo-lead-${leadId}`,
    payload: { account: 'hello', ...customerReplyHeaders(newRequest, 'Informazioni necessarie per preparare il preventivo Fancy Truck'), html: body },
  }).action;
}

async function setLeadProcedureStatus(leadId, status) {
  const stages = await odooCall('crm.stage', 'search_read', [[]], {
    fields: ['name'], limit: 100,
  });
  const selectedStage = procedureStage(stages, status);
  await odooCall('crm.lead', 'write', [[leadId], { stage_id: selectedStage.id }]);
  await odooCall('crm.lead', 'message_post', [[leadId]], {
    body: `<p><strong>Stato procedura: ${escapeHtml(status)}</strong></p>`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });
  store.audit('ODOO_LEAD_PROCEDURE_STATUS', { lead_id: leadId, status, stage_updated: true, stage_id: selectedStage.id });
}

async function quotationTemplate(kind) {
  const names = kind === 'rental'
    ? ['Noleggio Fancy Truck', 'Noleggio']
    : ['Brand Activation', 'Roadtour', 'Vendite Fancy Truck'];
  try {
    const schema = await odooCall('ir.model.fields', 'search_read', [[
      ['model', '=', 'sale.order.template'], ['name', 'in', ['note', 'payment_term_id']],
    ]], { fields: ['name'], limit: 10 });
    const optionalFields = ['note', 'payment_term_id'].filter(field => schema.some(item => item.name === field));
    for (const name of names) {
      const templates = await odooCall('sale.order.template', 'search_read', [[['name', 'ilike', name]]], {
        fields: ['name', ...optionalFields], limit: 5,
      });
      if (templates.length === 1) return templates[0];
    }
  } catch (error) {
    console.error(`MODELLO PREVENTIVO: controllo non completato - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
  }
  return null;
}

async function rentalAvailability(productId, dates) {
  if (!productId || !dates) return { checked: false, status: 'UNKNOWN', conflicts: [] };
  try {
    const conflicts = await odooCall('sale.order', 'search_read', [[
      ['state', '!=', 'cancel'], ['is_rental_order', '=', true],
      ['rental_start_date', '<', dates.end], ['rental_return_date', '>', dates.start],
      ['order_line.product_id', '=', productId],
    ]], {
      fields: ['name', 'state', 'partner_id', 'rental_start_date', 'rental_return_date', 'validity_date', 'signed_on'],
      order: 'rental_start_date asc', limit: 50,
    });
    return classifyRentalBookings(conflicts, { complete: conflicts.length < 50 });
  } catch (error) {
    console.error(`DISPONIBILITÀ NOLEGGIO: controllo non completato - ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
    return { checked: false, status: 'UNKNOWN', conflicts: [] };
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

async function createDraftFromCrmLead(lead, partner, kind, combinedText, key, parsed) {
  if (kind !== 'rental') throw new Error('I veicoli Fancy Truck sono esclusivamente a noleggio');
  const existing = await odooCall('sale.order', 'search_read', [[['opportunity_id', '=', lead.id]]], {
    fields: ['name', 'state', 'opportunity_id', 'is_rental_order'], limit: 1,
  });
  if (existing.length) return { order: existing[0], duplicate: true };
  store.cancelActionGroup(`missing-details:odoo-lead-${lead.id}`, 'REQUEST_COMPLETED');

  const dates = italianRentalDates(combinedText);
  const isRental = kind === 'rental';
  const vehicle = vehicleSearchTerm(combinedText);
  const template = await quotationTemplate(kind);
  let product = null;
  if (vehicle) {
    const models = catalogueModelsIn(vehicle);
    const verifiedIds = VERIFIED_ODOO_MODELS.filter(item => models.includes(item.model)).map(item => item.productId);
    const domain = verifiedIds.length ? ['|', ['id', 'in', verifiedIds], ['name', 'ilike', vehicle]] : [['name', 'ilike', vehicle]];
    const products = await odooCall('product.product', 'search_read', [domain], {
      fields: ['name', 'list_price', 'sale_ok', 'rent_ok', 'description_sale'], limit: 20,
    });
    product = selectExactProduct(products, vehicle, isRental);
  }

  const availability = isRental ? await rentalAvailability(product?.id, dates) : { checked: false, conflicts: [] };

  if (isRental && availability.status === 'UNAVAILABLE') {
    const action = approvals.queue(unavailableVehicleAction({
      leadId: lead.id, recipient: partner.email, product, dates,
    })).action;
    await setLeadProcedureStatus(lead.id, 'DA_INTEGRARE');
    return { awaiting_customer_choice: true, approval_id: action.id, availability: 'UNAVAILABLE' };
  }

  const logistics = await prepareRentalLogistics(combinedText);
  if (logistics.status === 'MISSING_ADDRESSES') {
    await setLeadProcedureStatus(lead.id, 'DA_INTEGRARE');
    await askCustomerForMissingDetails(lead.id, partner, null, logistics.missing, parsed);
    return { awaiting_customer_details: true, missing: logistics.missing };
  }
  const nativeRental = Boolean(product && dates && availability.checked);
  const line = nativeRental
    ? [0, 0, { product_id: product.id, product_uom_qty: 1, is_rental: true }]
    : draftProductLine(product, isRental, combinedText);
  const pricingPartners = await odooCall('res.partner', 'search_read', [[['id', '=', partner.id]]], {
    fields: ['company_type', 'vat', 'property_product_pricelist'], limit: 1,
  });
  if (!pricingPartners.length) throw new Error('Anagrafica per il listino non disponibile');
  const pricelistId = quotationPricelist(pricingPartners[0]);
  const values = {
    partner_id: partner.id, pricelist_id: pricelistId, opportunity_id: lead.id, client_order_ref: `AUTO:${key}`,
    origin: lead.name, is_rental_order: isRental, order_line: [line, ...logistics.lines,
      [0, 0, { display_type: 'line_note', name: logistics.lines.length
        ? 'LOGISTICA DA VERIFICARE: percorso stradale auto, inclusi ritorni. Verificare accessibilità del mezzo, ZTL, traino e tipo di trasporto prima dell’invio.'
        : 'LOGISTICA DA COMPLETARE: distanze di consegna e ritiro da verificare; importi non inclusi. Non inviare come preventivo completo.' }]],
  };
  if (template) {
    values.sale_order_template_id = template.id;
    if (template.note) values.note = template.note;
    if (Array.isArray(template.payment_term_id)) values.payment_term_id = template.payment_term_id[0];
  }
  const approvedTerms = await odooCall('account.payment.term', 'search_read', [[['name', '=', PAYMENT_TERM_NAME]]], {fields:['name'],limit:2});
  if (approvedTerms.length !== 1) throw Error('Condizione saldo alla conferma non configurata univocamente in Odoo');
  values.payment_term_id = approvedTerms[0].id;
  const deposit = depositAmount(product?.description_sale);
  values.note = rentalTerms(values.note, deposit);
  if (isRental && dates) {
    values.rental_start_date = dates.start;
    values.rental_return_date = dates.end;
  }
  const ids = await odooCall('sale.order', 'create', [[values]]);
  const orderId = Array.isArray(ids) ? ids[0] : ids;
  const order = await odooCall('sale.order', 'search_read', [[['id', '=', orderId]]], {
    fields: ['name', 'state', 'opportunity_id', 'is_rental_order', 'amount_total'], limit: 1,
  });
  const reviewItems = [...PIETRO_FINAL_CHECKS];
  if (deposit == null) reviewItems.push('BLOCCO CONDIZIONI: importo cauzione del veicolo non disponibile. Non inviare.');
  let rentalPriceVerified = false;
  if (nativeRental) {
    const pricedLines = await odooCall('sale.order.line', 'search_read', [[['order_id', '=', orderId], ['product_id', '=', product.id]]], {
      fields: ['is_rental', 'price_unit', 'product_uom_qty'], limit: 2,
    });
    rentalPriceVerified = pricedLines.length === 1 && pricedLines[0].is_rental === true
      && pricedLines[0].product_uom_qty === 1 && Number.isFinite(pricedLines[0].price_unit) && pricedLines[0].price_unit > 0;
    reviewItems.push(rentalPriceVerified ? `Tariffa calcolata da Odoo: ${pricedLines[0].price_unit}. Verificare condizioni e imposte.`
      : 'BLOCCO ECONOMICO: tariffa Odoo nulla o non verificabile. Non inviare.');
  }
  let logisticsPriceVerified = false;
  if (logistics.lines.length) {
    const transportLines = await odooCall('sale.order.line', 'search_read', [[['order_id', '=', orderId], ['product_id', '=', 7]]], {
      fields: ['name', 'price_unit', 'product_uom_qty', 'discount', 'is_rental'], limit: 3,
    });
    logisticsPriceVerified = transportLines.length === 2 && logistics.lines.every(([, , expected]) => transportLines.some(actual =>
      actual.name === expected.name && Math.abs(actual.product_uom_qty - expected.product_uom_qty) < 0.0001
      && actual.price_unit === 2 && actual.discount === 0 && actual.is_rental === false));
    reviewItems.push(logisticsPriceVerified ? 'Logistica standard calcolata da Odoo a 2 EUR/km, minimo separato consegna/ritiro 200 EUR. Verificare tipo di trasporto e percorribilità del mezzo.'
      : 'BLOCCO ECONOMICO: prezzo o quantità della logistica Odoo non corrispondono alla regola attesa. Non inviare.');
    reviewItems.push(`Percorsi ORS (profilo auto, ${logistics.routes.calculatedAt}): ${JSON.stringify(logistics.routes)}. Distanze totali: ${JSON.stringify(logistics.distances)}.`);
  } else reviewItems.push(`LOGISTICA NON INCLUSA: verifica manuale necessaria (${logistics.status}${logistics.reason ? ': ' + logistics.reason : ''}). Preventivo incompleto.`);
  reviewItems.push(template ? `Modello applicato: ${template.name}` : 'Modello di preventivo da verificare');
  reviewItems.push(product ? (isRental ? `Mezzo individuato: ${product.name}. ${nativeRental ? "Calcolo tariffa affidato a Odoo." : "Periodo, modello o disponibilità da verificare: tariffa non calcolata."}` : `Prodotto individuato: ${product.name}. Verificare il prezzo prima dell’invio.`) : 'Prodotto e prezzo da selezionare');
  if (isRental) {
    reviewItems.push(dates ? `Periodo: ${dates.start} — ${dates.end}` : 'Periodo da verificare');
    if (!availability.checked) reviewItems.push('Disponibilità non verificabile senza prodotto e periodo certi');
    else if (availability.status === 'OPTIONED') reviewItems.push('Veicolo soltanto opzionato: disponibilità da confermare, non dichiararlo indisponibile.');
    else reviewItems.push('Nessun impegno definitivo rilevato negli ordini Odoo. Verificare logistica e disponibilità definitiva prima della conferma.');
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
  store.audit('ODOO_DRAFT_BUNDLE_CREATED', { lead_id: lead.id, order_id: orderId, project_id: economicProject.id });
  return { order: order[0] || { id: orderId }, project: economicProject, duplicate: false, rental_price_verified: rentalPriceVerified, logistics_status: logistics.status, logistics_price_verified: logisticsPriceVerified };
}

async function findReplyLead(senderEmail, subject, parsed = {}) {
  const partners = await odooCall('res.partner', 'search_read', [[
    ['email', '=ilike', senderEmail],
  ]], { fields: ['id'], limit: 50 });
  const partnerIds = partners.map((partner) => partner.id);
  const referenceMatch = await matchQuotationThread({subject,text:currentMessage(parsed.text),partnerIds,call:odooCall});
  if(referenceMatch)return referenceMatch;
  const senderDomain = partnerIds.length
    ? ['|', ['email_from', '=ilike', senderEmail], ['partner_id', 'in', partnerIds]]
    : [['email_from', '=ilike', senderEmail]];
  const leads = await odooCall('crm.lead', 'search_read', [[
    ['type', '=', 'opportunity'], ['active', '=', true], ...senderDomain,
  ]], { fields: ['name', 'description', 'partner_id', 'stage_id', 'create_date'], order: 'create_date desc', limit: 20 });
  const normalized = normalizeCommercialSubject(subject);
  const matched = leads.filter((lead) => {
    const leadSubject = normalizeCommercialSubject(lead.name);
    return normalized && leadSubject && (normalized.includes(leadSubject) || leadSubject.includes(normalized));
  });
  if (matched.length === 1) {
    const orders=await odooCall('sale.order','search_read',[[['opportunity_id','=',matched[0].id]]],{fields:['id'],limit:101});
    if(orders.length>=101)return {ambiguous:true,candidate_ids:[matched[0].id],reason:'too_many_related_orders'};
    return { lead: matched[0], ambiguous: false, ...(orders.length?{order_ids:orders.map(o=>o.id)}:{}) };
  }
  if (matched.length > 1) return { lead: null, ambiguous: true, candidate_ids: matched.map((lead) => lead.id) };
  if(leads.length)return {lead:null,ambiguous:true,candidate_ids:leads.map(l=>l.id),reason:'new_thread_existing_customer'};
  return { lead: null, ambiguous: false, candidate_ids: [] };
}

async function processQuoteReply(parsed, uid, lead) {
  parsed = { ...parsed, text: currentMessage(parsed.text) };
  const sender = parsed.from?.value?.[0];
  const key = emailMarker(parsed, uid);
  const marker = `[AUTO:${key}]`;
  if (String(lead.description || '').includes(marker)) return { skipped: true, duplicate: true, lead_id: lead.id };

  const partnerId = Array.isArray(lead.partner_id) ? lead.partner_id[0] : lead.partner_id;
  let partner = null;
  if (partnerId) {
    const partners = await odooCall('res.partner', 'search_read', [[['id', '=', partnerId]]], {
      fields: ODOO_PARTNER_FIELDS, limit: 1,
    });
    if (!partners.length) throw new Error(`Contatto Odoo non trovato per opportunità ${lead.id}`);
    partner = await updatePartnerFromText(partners[0], parsed.text);
  } else {
    const resolved = await findOrCreatePartnerFromEmail(parsed);
    if (resolved.partner) partner = await updatePartnerFromText(resolved.partner, parsed.text);
  }
  const replyText = String(parsed.text || '').trim().slice(0, 12000);
  const combinedText = `${lead.description || ''}\n\nRisposta cliente:\n${replyText}\n\n${marker}`;
  await odooCall('crm.lead', 'write', [[lead.id], {
    description: combinedText, ...(partner?.id ? { partner_id: partner.id } : {}),
  }]);
  await odooCall('crm.lead', 'message_post', [[lead.id]], {
    body: `<p><strong>Risposta cliente acquisita automaticamente</strong></p><p>${escapeHtml(replyText).replace(/\n/g, '<br>')}</p>`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });

  const kind = quoteRequestKind(lead.name, combinedText) || 'unknown';
  const missing = requiredRequestDetails(kind, lead.name, combinedText);
  const optional = missingRequestDetails(kind, lead.name, combinedText).filter(item => item.includes('(facoltativo)'));
  if (kind === 'event_food') return queueStreetfoodHandoff(lead.id, sender?.address, parsed);
  if (!partner) missing.unshift('ragione sociale o partita IVA per identificare il cliente');
  if (missing.length) {
    await setLeadProcedureStatus(lead.id, 'DA_INTEGRARE');
    await askCustomerForMissingDetails(lead.id, partner || { email: sender?.address }, sender?.name, [...new Set([...missing, ...optional])], parsed);
    return { lead_id: lead.id, reply: true, missing };
  }
  store.cancelActionGroup(`missing-details:odoo-lead-${lead.id}`, 'REQUEST_COMPLETED');
  if (['catering', 'brand_activation'].includes(kind)) {
    await setLeadProcedureStatus(lead.id, 'PRONTA_CONTROLLO_PIETRO');
    return { lead_id: lead.id, reply: true, kind, ready_for_review: true };
  }
  const draft = await createDraftFromCrmLead(lead, partner, kind, combinedText, key, parsed);
  if (draft.awaiting_customer_choice || draft.awaiting_customer_details) return { lead_id: lead.id, reply: true, ...draft };
  await setLeadProcedureStatus(lead.id, 'PRONTA_CONTROLLO_PIETRO');
  return { lead_id: lead.id, reply: true, order_id: draft.order?.id, ready_for_review: true };
}

async function processQuoteRequest(parsed, uid, accountName, uidValidity) {
  parsed = { ...parsed, text: currentMessage(parsed.text) };
  const sender = parsed.from?.value?.[0];
  const senderEmail = String(sender?.address || '').trim().toLowerCase();
  const decision = await routeCommercialMessage({
    parsed, uid, account: accountName, uidValidity, store, findLead: findReplyLead,
  });
  if (decision.action === 'skip') return { skipped: true, reason: decision.reason };
  if (decision.action === 'review') return { suspended: true, ...decision };
  if (decision.action === 'link') return linkThreadMessage({parsed,match:decision.match,direction:'incoming',call:odooCall,store});
  if (decision.action === 'reply') return processQuoteReply(parsed, uid, decision.lead);
  const kind = decision.kind;

  const key = emailMarker(parsed, uid);
  const marker = `[AUTO:${key}]`;
  const existingLead = await odooCall('crm.lead', 'search_read', [[['description', 'ilike', marker]]], {
    fields: ['name', 'partner_id', 'stage_id'], limit: 1,
  });
  if (existingLead.length) return { skipped: true, duplicate: true, lead_id: existingLead[0].id };

  const found = await findOrCreatePartnerFromEmail(parsed);
  const created = found.created;
  const partner = found.partner ? await updatePartnerFromText(found.partner, parsed.text) : null;
  const cleanBody = String(parsed.text || '').trim().slice(0, 12000);
  const leadIds = await odooCall('crm.lead', 'create', [[{
    name: String(parsed.subject || `Richiesta da ${sender?.name || senderEmail}`).slice(0, 240),
    type: 'opportunity', partner_id: partner?.id || false, contact_name: sender?.name || false,
    email_from: senderEmail, description: `Richiesta ricevuta via ${accountName}@fancytruck.it\n\n${cleanBody}\n\n${marker}`,
  }]]);
  const leadId = Array.isArray(leadIds) ? leadIds[0] : leadIds;
  store.audit('ODOO_LEAD_CREATED', { lead_id: leadId, sender_domain: emailDomain(senderEmail), partner_id: partner?.id || null });

  const missingFiscal = partner ? missingFiscalDetails(partner) : ['ragione sociale o partita IVA'];
  const missingOperational = requiredRequestDetails(kind, parsed.subject, parsed.text);
  if (kind === 'event_food') return queueStreetfoodHandoff(leadId, senderEmail, parsed);
  const operationalNote = `Categoria: ${REQUEST_CATEGORIES[kind]?.label || 'servizio da precisare'}. Raccogliere i dati specifici prima della preparazione del preventivo.`;
  await odooCall('crm.lead', 'message_post', [[leadId]], {
    body: `${operationalNote}${partner?._dataIssues?.length ? `<br>Controlli anagrafici: ${partner._dataIssues.map(escapeHtml).join(', ')}.` : ''}${missingFiscal.length ? `<br>Dati anagrafici da integrare: ${missingFiscal.join(', ')}.` : ''}${missingOperational.length ? `<br>Dati operativi da integrare: ${missingOperational.join(', ')}.` : ''}`,
    message_type: 'comment', subtype_xmlid: 'mail.mt_note',
  });

  const missingForCustomer = [...missingOperational];
  if (!partner) missingForCustomer.unshift('ragione sociale o partita IVA per identificare il cliente');
  if (missingForCustomer.length) {
    await setLeadProcedureStatus(leadId, 'DA_INTEGRARE');
    await askCustomerForMissingDetails(leadId, partner || { email: senderEmail }, sender?.name, [...new Set([...missingForCustomer, ...missingRequestDetails(kind, parsed.subject, parsed.text).filter(item => item.includes('(facoltativo)'))])], parsed);
    return { lead_id: leadId, partner_id: partner?.id || null, partner_created: created, order_id: null, kind, missing: missingForCustomer };
  }

  const lead = { id: leadId, name: String(parsed.subject || `Richiesta da ${sender?.name || senderEmail}`), description: cleanBody };
  if (['catering', 'brand_activation'].includes(kind)) {
    await setLeadProcedureStatus(leadId, 'PRONTA_CONTROLLO_PIETRO');
    return { lead_id: leadId, kind, ready_for_review: true };
  }
  const draft = await createDraftFromCrmLead(lead, partner, kind, cleanBody, key, parsed);
  if (draft.awaiting_customer_choice || draft.awaiting_customer_details) return { lead_id: leadId, ...draft };
  await setLeadProcedureStatus(leadId, 'PRONTA_CONTROLLO_PIETRO');
  return { lead_id: leadId, partner_id: partner.id, partner_created: created, order_id: draft.order?.id, kind, ready_for_review: true };
}

async function pollQuoteRequests(accountName) {
  const results = await withImap(accountName, async (client) => {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      return await pollMailbox({ client, account: accountName, store, parse: simpleParser,
        processMessage: (parsed, uid, uidValidity) => runMailOperation({
          store, account: accountName, validity: uidValidity, uid, parsed,
          execute: () => processQuoteRequest(parsed, uid, accountName, uidValidity),
        }),
      });
    } finally { lock.release(); }
  });

  const created = results.filter((row) => row.lead_id && !row.duplicate);
  const suspended = results.filter((row) => row.suspended);
  console.log(`RICHIESTE ${accountName.toUpperCase()}: controllo completato, ${results.length} nuovi messaggi, ${created.length} nuove lead elaborate, ${suspended.length} sospese`);
  return { rows: results, created, suspended };
}

async function processSentMessage(parsed, uid, account, validity, mailbox) {
  const sender=String(parsed.from?.value?.[0]?.address||'').toLowerCase();
  if(sender!==accountConfig(account).email.toLowerCase())return {skipped:true,reason:'mittente diverso dalla casella'};
  const recipients=[...new Set([...(parsed.to?.value||[]),...(parsed.cc?.value||[])].map(v=>String(v.address||'').toLowerCase()).filter(v=>v&&!v.endsWith('@fancytruck.it')))];
  const queue=(reason,candidates=[])=>{
    const {item}=store.queueClassification({source_key:JSON.stringify(['sent',account,parsed.messageId||`${validity}:${uid}`]),account,mailbox,uid,uid_validity:validity,
      message_id:parsed.messageId||null,sender,subject:parsed.subject||'',excerpt:currentMessage(parsed.text).slice(0,4000),reason,candidate_ids:candidates});
    return {suspended:true,review_id:item.id,reason};
  };
  if(!recipients.length)return {skipped:true,reason:'messaggio interno'};
  if(recipients.length!==1)return queue('outgoing_multiple_recipients');
  const match=await findReplyLead(recipients[0],parsed.subject,parsed);
  if(match.ambiguous||!match.lead)return queue(match.reason||'outgoing_thread_unmatched',match.candidate_ids);
  return linkThreadMessage({parsed,match,direction:'outgoing',call:odooCall,store});
}

let operationalCycleRunning = false;

async function runOperationalCycle({ force = false } = {}) {
  assertWritable(runtime);
  if (!force && !withinOperatingWindow()) return { skipped: true, reason: 'fuori fascia 08:00-19:59 Europe/Rome' };
  if (operationalCycleRunning) return { skipped: true, reason: 'ciclo operativo già in esecuzione' };
  operationalCycleRunning = true;
  let cycle = null;
  try {
    cycle = store.beginCycle(['aruba:hello', 'aruba:pietro', 'odoo:crm']);
    const summary = { read: 0, created: 0, updated: 0, duplicates: 0, suspended: 0, failed: 0, errors: [] };
    if (process.env.EXTERNAL_BACKUP_ENABLED === 'true') {
      try {
        const backup = await runExternalBackup({store, env:process.env});
        if (backup.status === 'VERIFIED') {
          store.integration('backup:external', {status:'OK',last_success_at:backup.verified_at,key:backup.key,bytes:backup.bytes});
          console.log('BACKUP ESTERNO: caricamento e ripristino di controllo verificati');
        }
      } catch {
        store.integration('backup:external', {status:'ERROR',error:'Backup esterno non verificato; controllare configurazione e spazio'});
        summary.failed++;
        summary.errors.push('Backup esterno non verificato');
        console.error('BACKUP ESTERNO: controllo non completato');
      }
    }
    if (process.env.CRM_NOTIFICATION_CLEANUP_ENABLED === 'true') {
      try {
        const result = await reconcileCrm({ call: odooCall, store });
        store.integration('odoo:notification_cleanup', { status: 'OK', last_success_at: new Date().toISOString(), ...result });
        console.log(`PULIZIA CRM: ${JSON.stringify(result)}`);
      } catch (error) {
        summary.failed++;
        summary.errors.push(`Pulizia CRM: ${error.message}`);
        store.integration('odoo:notification_cleanup', { status: 'ERROR', error: error.message });
        console.error(`PULIZIA CRM: ERRORE - ${error.message}`);
      }
    }
    for (const source of ['hello', 'pietro']) {
      try {
        const result = await pollQuoteRequests(source);
        summary.read += result.rows.length;
        summary.created += result.created.length;
        summary.suspended += result.suspended.length;
        summary.errors.push(...result.suspended.map((row) => `${source} UID ${row.uid}: ${row.error}`));
        store.integration(`aruba:${source}`, {
          status: result.suspended.length ? 'OK_WITH_SUSPENSIONS' : 'OK',
          last_success_at: new Date().toISOString(),
          error: result.suspended.length ? `${result.suspended.length} elementi sospesi` : null,
        });
      } catch (error) {
        summary.failed += 1;
        summary.errors.push(`${source}: ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
        store.integration(`aruba:${source}`, { status: 'CONTROLLO NON COMPLETATO', error: summary.errors.at(-1) });
      }
    }
    try {
      const replies = await pollOdooLeadReplies();
      summary.read += replies.length;
      summary.updated += replies.filter((row) => row.reply && !row.duplicate).length;
      const suspended = replies.filter(row => row.suspended);
      summary.suspended += suspended.length;
      summary.errors.push(...suspended.map(row => `odoo: ${row.error || row.reason}`));
      store.integration('odoo:crm', { status: suspended.length ? 'OK_WITH_SUSPENSIONS' : 'OK',
        last_success_at: new Date().toISOString(), error: suspended.length ? `${suspended.length} elementi sospesi` : null });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(`odoo: ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
      store.integration('odoo:crm', { status: 'CONTROLLO NON COMPLETATO', error: summary.errors.at(-1) });
    }
    if(process.env.SENT_TRACKING_ENABLED==='true')for(const account of ['hello','pietro']){
      try{
        const result=await withImap(account,client=>pollSentMailbox({client,account,store,parse:simpleParser,
          processMessage:(parsed,uid,validity,mailbox)=>runMailOperation({store,account,mailbox,validity,uid,parsed,
            execute:()=>processSentMessage(parsed,uid,account,validity,mailbox)})}));
        const suspended=result.rows.filter(r=>r.suspended).length;
        summary.suspended+=suspended;
        store.integration(`sent:${account}`,{status:suspended?'OK_WITH_SUSPENSIONS':'OK',mailbox:result.mailbox,initialized:result.initialized,last_success_at:new Date().toISOString()});
        console.log(`POSTA INVIATA ${account}: ${result.initialized?'punto di partenza salvato':result.rows.length+' messaggi'}, ${suspended} da verificare`);
      }catch(error){summary.failed++;summary.errors.push(`sent:${account}: ${error.message}`);store.integration(`sent:${account}`,{status:'CONTROLLO NON COMPLETATO',error:error.message});}
    }
    return store.finishCycle(cycle.id, {
      ...summary,
      status: summary.failed ? 'CONTROLLO NON COMPLETATO' : summary.suspended ? 'COMPLETATO_CON_SOSPENSIONI' : 'COMPLETED',
    });
  } catch (error) {
    if (cycle) {
      try {
        store.finishCycle(cycle.id, {
          failed: 1,
          status: 'CONTROLLO NON COMPLETATO',
          errors: [error instanceof Error ? error.message : 'errore sconosciuto'],
        });
      } catch {}
    }
    throw error;
  } finally {
    operationalCycleRunning = false;
  }
}

async function pollOdooLeadReplies() {
  return pollOdooMessages({ store,
    search: domain => odooCall('mail.message', 'search_read', [domain], {
      fields: ['res_id', 'subject', 'body', 'email_from', 'author_id', 'date', 'message_id'],
      order: 'id asc', limit: 100,
    }),
    processMessage: async message => {
    const emailMatch = String(message.email_from || '').match(/<([^>]+)>/) || String(message.email_from || '').match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    const senderEmail = String(emailMatch?.[1] || '').trim().toLowerCase();
    if (!senderEmail || senderEmail.endsWith('@fancytruck.it')) return { skipped: true };
    const leads = await odooCall('crm.lead', 'search_read', [[['id', '=', message.res_id]]], {
      fields: ['name', 'description', 'partner_id', 'stage_id', 'create_date', 'active'], context: { active_test: false }, limit: 1,
    });
    if (!leads.length) throw new Error(`Opportunità ${message.res_id} non disponibile per il messaggio ${message.id}`);
    if (!leads[0].active) return { skipped: true, reason: 'opportunità archiviata', lead_id: message.res_id };
    const authorName = Array.isArray(message.author_id) ? message.author_id[1] : null;
    const parsed = {
      messageId: message.message_id || `odoo-mail-message-${message.id}`,
      subject: message.subject || leads[0].name,
      date: message.date ? new Date(String(message.date).replace(' ', 'T') + 'Z') : new Date(),
      text: plainTextFromHtml(message.body),
      from: { value: [{ name: authorName, address: senderEmail }] },
    };
    return runMailOperation({ store, account: 'odoo', mailbox: 'crm.lead',
      validity: 'mail.message', uid: message.id, parsed,
      execute: () => processQuoteReply(parsed, `odoo-${message.id}`, leads[0]),
    });
    },
  });
}

const reviewDirectory = fileURLToPath(new URL('../public/', import.meta.url));
function reviewHeaders(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  next();
}
app.get('/reviews', reviewHeaders, (_req, res) => res.sendFile('reviews.html', { root: reviewDirectory }));
app.get('/briefing', reviewHeaders, (_req, res) => res.sendFile('briefing.html', { root: reviewDirectory }));
app.use('/review-assets', reviewHeaders, express.static(reviewDirectory, { index: false, dotfiles: 'deny' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fancy-truck-aruba-api' });
});

app.get('/v1/diagnostics', requireToken, (_req, res) => {
  const state = store.state;
  const lastCycle = state.cycles.at(-1) || null;
  const operatingNow = withinOperatingWindow();
  const stale = operatingNow && (lastCycle?.ended_at
    ? Date.now() - new Date(lastCycle.ended_at).getTime() > 2 * 60 * 60 * 1000
    : Date.now() - startedAt > 10 * 60 * 1000);

  // Liveness stays HTTP 200 while the process is alive. A stale automation
  // cycle is reported as degraded data instead of disconnecting the web API.
  res.status(200).json({
    ok: true,
    ready: true,
    service: 'fancy-truck-aruba-api',
    procedure_version: COMMERCIAL_PROCEDURE_VERSION,
    automation_status: runtime.readOnly || !runtime.automationEnabled ? 'DISABLED' : stale ? 'DEGRADED' : 'OK',
    environment: runtime.environment,
    read_only: runtime.readOnly,
    automation_stale: stale,
    operating_window: '08:00-19:59 Europe/Rome',
    state_file: store.filePath,
    last_cycle: lastCycle,
    pending_approvals: Object.values(state.actions).filter((item) => !['EXECUTED', 'CANCELLED'].includes(item.status)).length,
    configured: {
      hello: Boolean(process.env.HELLO_EMAIL && process.env.HELLO_PASSWORD),
      pietro: Boolean(process.env.PIETRO_EMAIL && process.env.PIETRO_PASSWORD),
      odoo: Boolean(process.env.ODOO_URL && process.env.ODOO_DB && process.env.ODOO_API_KEY),
      odoo_partner_autocomplete: process.env.ODOO_PARTNER_AUTOCOMPLETE !== 'false',
      gmail_double_check: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN),
      sistemi_cloud: Boolean(process.env.SISTEMI_API_URL && process.env.SISTEMI_API_TOKEN),
      bank: Boolean(process.env.BANK_API_URL && process.env.BANK_API_TOKEN),
    },
  });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ ok: true, ready: true, service: 'fancy-truck-aruba-api' });
});

app.use('/v1', requireToken);
app.use('/v1', readOnlyMiddleware(runtime));

let briefingInFlight = null;
app.get('/v1/briefing', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  briefingInFlight ??= buildBriefing({ call: odooCall, state: store.snapshot() })
    .finally(() => { briefingInFlight = null; });
  res.json(await briefingInFlight);
});

app.get('/v1/classification-reviews', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, can_resolve: !runtime.readOnly && ['admin', 'reviewer'].includes(_req.accessRole),
    items: Object.values(store.state.classification_reviews).filter(item => item.status === 'DA_CLASSIFICARE') });
});

app.post('/v1/classification-reviews/:id/resolve', (req, res) => {
  try {
    const item = store.resolveClassification(req.params.id, req.body?.resolution, req.body?.note, req.accessRole);
    res.json({ ok: true, item });
  } catch (error) { res.status(409).json({ ok: false, error: error.message }); }
});

app.get('/v1/procedure/commercial', (_req, res) => {
  res.json({ ok: true, procedure: COMMERCIAL_PROCEDURE });
});

app.get('/v1/automation/status', (_req, res) => {
  const state = store.state;
  res.json({ ok: true, integrations: state.integrations, last_cycle: state.cycles.at(-1) || null,
    actions: Object.values(state.actions).map(({ confirmation_digest: _hidden, ...item }) => item) });
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
      email: req.body?.email || false, phone: contactPhoneValue(req.body),
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
    // Standard logistics must carry separate verified distances, never a guessed total.
    if (lines.some(line => Number(line?.product_id) === 7 && !['line_note', 'line_section'].includes(line?.display_type))) {
      throw new Error('Per Logistica usare standard_logistics con deliveryKm e collectionKm separati');
    }
    if (req.body?.standard_logistics !== undefined && req.body?.standard_logistics_routes !== undefined) {
      throw new Error('Fornire percorsi oppure totali verificati, non entrambi');
    }
    const logisticsInput = req.body?.standard_logistics_routes !== undefined
      ? logisticsDistancesFromRoutes(req.body.standard_logistics_routes) : req.body?.standard_logistics;
    // Flat totals, when supplied by the operator, already include both journeys.
    const logistics = logisticsInput === undefined ? [] : standardLogisticsLines(logisticsInput);
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
      order_line: [...orderLines, ...logistics],
    };
    if (logistics.length) {
      const pricingPartners = await odooCall('res.partner', 'search_read', [[['id', '=', partnerId]]], {
        fields: ['company_type', 'vat', 'property_product_pricelist'], limit: 1,
      });
      if (pricingPartners.length !== 1) throw new Error('Listino cliente non verificabile');
      values.pricelist_id = quotationPricelist(pricingPartners[0]);
    }
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
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
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
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
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
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
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
    assertWritable(runtime);
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
      html: payload.html || undefined, inReplyTo: payload.inReplyTo || undefined, references: payload.references || undefined });
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

const server = app.listen(port, runtime.host, (error) => {
  if (error) {
    console.error(`Avvio server fallito: ${error.code || 'errore sconosciuto'}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Fancy Truck Aruba API in ascolto sulla porta ${server.address().port}`);
  if (runtime.startupChecks) {
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
  }
  if (runtime.automationEnabled && !runtime.readOnly) {
    setTimeout(() => runOperationalCycle().catch((error) => console.error(`CICLO OPERATIVO: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`)), 15000);
    setInterval(() => runOperationalCycle().catch((error) => console.error(`CICLO OPERATIVO: ERRORE - ${error instanceof Error ? error.message : 'errore sconosciuto'}`)), 60 * 60 * 1000);
  }
});

// Module exports permit isolated contract tests without exposing extra HTTP routes.
export { processQuoteRequest, processQuoteReply, processSentMessage, findReplyLead, server, store, approvals };

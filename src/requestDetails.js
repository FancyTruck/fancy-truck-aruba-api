import { CATALOGUE_URL, catalogueModelsIn, genericVehicleFamily } from './vehicleCatalogue.js';
// User-defined intake categories. Recognition is conservative and text based.
export const REQUEST_CATEGORIES = {
  event_food: { label: 'Partecipazione a evento food', contact: 'cristiano@fancytruck.it' },
  catering: { label: 'Catering' },
  rental: { label: 'Noleggio foodtruck', catalogue: CATALOGUE_URL },
  brand_activation: { label: 'Brand activation' },
};
export function missingRequestDetails(kind, subject, text) {
  const value = `${subject || ''}\n${text || ''}`;
  const date = /\b(?:\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre))\b/i.test(value);
  const location = /\b(?:location|luogo|località|consegna|indirizzo)\s*:\s*\S+/i.test(value) || /\b(?:a|in|presso)\s+[A-ZÀ-ÖØ-Þ][\p{L}'-]+/u.test(value) || /\b(?:milano|roma|genova|torino|napoli|bologna|firenze|venezia|padova|verona|bari|palermo|cagliari)\b/i.test(value);
  const model = !genericVehicleFamily(value) && (catalogueModelsIn(value).length > 0 || /\b(?:airstream|fiat\s*238|citro[eë]n|horse\s*(?:trailer|box)|horsebox|school\s*bus|vw\s*t1|framo|ape)\b/i.test(value) || /\b(?:modello|veicolo)\s*:\s*\S+/i.test(value));
  const duration = /\b\d+(?:[.,]\d+)?\s*(?:ore|giorni?|gg|settimane?|mesi?)\b/i.test(value) || (value.match(/\b(?:[01]?\d|2[0-3])[:.]\d{2}\b/g) || []).length >= 2;
  const times = (value.match(/\b(?:[01]?\d|2[0-3])[:.]\d{2}\b/g) || []).length >= 2;
  const stated = pattern => pattern.test(value);
  const missing = [];
  const need = (present, label) => { if (!present) missing.push(label); };
  if (kind === 'event_food') return [];
  if (kind === 'unknown') {
    need(false, 'servizio richiesto: partecipazione a evento food, catering, noleggio foodtruck o brand activation');
    return missing;
  }
  need(kind === 'rental' ? (value.match(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?\b|\b\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/gi) || []).length >= 2 || /\b(?:stesso giorno|in giornata)\b/i.test(value) && date : date, kind === 'rental' ? 'date di inizio e fine noleggio' : 'data o date dell’attività');
  need(location, kind === 'rental' ? 'località di consegna' : 'location');
  if (kind === 'catering') {
    need(stated(/\b\d+\s*(?:ospiti|persone|invitati|partecipanti)\b|\b(?:ospiti|persone)\s*:\s*\d+/i), 'numero di ospiti');
    need(duration, 'durata del servizio');
    need(stated(/\b\d+\s*food\s*truck|\bnumero\s*(?:di\s*)?food\s*truck\s*:\s*\d+/i), 'numero di foodtruck');
    need(stated(/\bbudget\s*[:=]?\s*(?:\d|€|non disponibile|da definire)|\d\s*(?:euro|€)/i), 'budget, se disponibile (facoltativo)');
    need(stated(/\b(?:servizio desiderato|servizio richiesto|men[uù])\s*:\s*\S+|\b(?:aperitivo|pranzo|cena|colazione|buffet|cocktail)\b/i), 'servizio desiderato');
  } else if (kind === 'rental') {
    need(model, genericVehicleFamily(value) === 'Horse Trailer' ? 'variante Horse Trailer desiderata: Legno o Vintage' : `modello scelto, consultabile su ${CATALOGUE_URL}`);
    need(times, 'orari di inizio e fine noleggio');
    need(stated(/personalizzazion|wrapping|\blogo\b/i), 'eventuali personalizzazioni (anche nessuna)');
    need(stated(/attrezzatur/i), 'attrezzature necessarie (anche nessuna)');
    need(stated(/allestiment/i), 'allestimenti richiesti (anche nessuno)');
    need(stated(/richieste particolari|esigenze particolari|nessun.altr/i), 'eventuali richieste particolari (anche nessuna)');
  } else if (kind === 'brand_activation') {
    need(stated(/\bconcept\b/i), 'concept, se già definito (facoltativo)');
    need(model, 'veicolo desiderato');
    for (const [pattern,label] of [[/allestiment/i,'allestimenti'],[/personalizzazion|wrapping|\blogo\b/i,'personalizzazioni'],[/\bstaff\b|personale/i,'staff'],[/gestione (?:del )?servizio/i,'eventuale gestione del servizio'],[/permess/i,'permessi'],[/adempiment/i,'adempimenti']]) need(stated(pattern), `${label}: esigenze e cosa è già previsto`);
  } else {
    need(model, 'mezzo o struttura richiesta');
  }
  return missing;
}
export function requiredRequestDetails(kind, subject, text) {
  return missingRequestDetails(kind, subject, text).filter(item => !item.includes('(facoltativo)'));
}

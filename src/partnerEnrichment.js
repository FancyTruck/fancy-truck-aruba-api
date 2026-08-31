function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

export function explicitCompanyName(text) {
  return String(text || '').match(/(?:ragione\s+sociale|societ[aà]|azienda)\s*[:\-]\s*([^\n\r;]{2,120})/i)?.[1]?.trim() || null;
}

export function selectCertainAutocompleteResult(results, { vat = null, companyName = null } = {}) {
  const rows = Array.isArray(results) ? results.filter(Boolean) : [];
  if (vat) {
    const wanted = normalizedText(vat).replace(/^IT/, '');
    const exact = rows.filter((row) => normalizedText(row.vat).replace(/^IT/, '') === wanted);
    return exact.length === 1 ? exact[0] : null;
  }
  if (companyName) {
    const wanted = normalizedText(companyName);
    const exact = rows.filter((row) => normalizedText(row.name) === wanted);
    return exact.length === 1 ? exact[0] : null;
  }
  return null;
}

export function partnerValuesFromAutocomplete(result, partner = {}) {
  if (!result) return {};
  const values = {};
  const scalarFields = ['street', 'street2', 'zip', 'city', 'phone', 'website', 'vat'];
  for (const field of scalarFields) {
    if (!partner[field] && result[field]) values[field] = result[field];
  }
  for (const field of ['country_id', 'state_id']) {
    const id = result[field]?.id || (Number.isInteger(result[field]) ? result[field] : null);
    if (!partner[field] && id) values[field] = id;
  }
  if (result.name) values.name = result.name;
  values.company_type = 'company';
  return values;
}

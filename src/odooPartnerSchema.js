export const ODOO_PARTNER_FIELDS = Object.freeze([
  'name',
  'company_type',
  'email',
  'phone',
  'vat',
  'street',
  'zip',
  'city',
  'l10n_it_codice_fiscale',
  'l10n_it_pa_index',
  'l10n_it_pec_email',
]);

export function hasPartnerPhone(partner) {
  return Boolean(String(partner?.phone || '').trim());
}

export function contactPhoneValue(input = {}) {
  const value = String(input.phone || input.mobile || '').trim();
  return value || false;
}

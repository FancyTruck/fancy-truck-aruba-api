import test from 'node:test';
import assert from 'node:assert/strict';
import { contactPhoneValue, hasPartnerPhone, ODOO_PARTNER_FIELDS } from '../src/odooPartnerSchema.js';

test('partner fields only request the supported Odoo phone field', () => {
  assert.equal(ODOO_PARTNER_FIELDS.includes('phone'), true);
  assert.equal(ODOO_PARTNER_FIELDS.includes('mobile'), false);
});

test('mobile API input is mapped to the Odoo phone field', () => {
  assert.equal(contactPhoneValue({ mobile: '+39 333 1234567' }), '+39 333 1234567');
  assert.equal(contactPhoneValue({ phone: '010 123456', mobile: '+39 333 1234567' }), '010 123456');
  assert.equal(contactPhoneValue({}), false);
});

test('partner phone presence uses the supported field', () => {
  assert.equal(hasPartnerPhone({ phone: '010 123456' }), true);
  assert.equal(hasPartnerPhone({ phone: '   ' }), false);
});

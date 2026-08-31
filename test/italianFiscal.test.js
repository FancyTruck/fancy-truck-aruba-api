import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidItalianFiscalCode, isValidItalianVat } from '../src/italianFiscal.js';

test('valida partita IVA e codice fiscale italiani', () => {
  assert.equal(isValidItalianVat('12345670546'), true);
  assert.equal(isValidItalianVat('12345670547'), false);
  assert.equal(isValidItalianFiscalCode('MRTMTT91D08F205J'), true);
  assert.equal(isValidItalianFiscalCode('JK8G261ZPLCBBLDL'), false);
  assert.equal(isValidItalianFiscalCode('12345670546'), true);
});

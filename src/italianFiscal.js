const ODD_FISCAL_VALUES = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function normalized(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function isValidItalianVat(value) {
  const vat = normalized(value).replace(/^IT/, '');
  if (!/^\d{11}$/.test(vat)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(vat[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(vat[10]);
}

export function isValidItalianFiscalCode(value) {
  const fiscalCode = normalized(value);
  if (/^\d{11}$/.test(fiscalCode)) return isValidItalianVat(fiscalCode);
  if (!/^[A-Z0-9]{16}$/.test(fiscalCode)) return false;
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    const character = fiscalCode[index];
    if (index % 2 === 0) sum += ODD_FISCAL_VALUES[character];
    else sum += /\d/.test(character) ? Number(character) : character.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === fiscalCode[15];
}

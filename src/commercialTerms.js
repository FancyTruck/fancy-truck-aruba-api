export const PAYMENT_TERM_NAME = 'Fancy AI — saldo alla conferma';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function depositAmount(description) {
  const matches = [...String(description || '').matchAll(/cauzione\s*(?:di|pari a|:)?\s*€\s*(\d[\d.,]*)/gi)];
  const values = matches.map(m => Number(m[1].includes(',') ? m[1].replace(/\./g,'').replace(',','.') : m[1].replace(/\.(?=\d{3}(?:\D|$))/g,'')));
  return values.length && values.every(n => Number.isFinite(n) && n > 0 && n === values[0]) ? values[0] : null;
}
export function rentalTerms(base, deposit) {
  // Replace the known legacy payment/deposit section; retain preceding contract text.
  let retained = String(base || '').replace(/<p><strong>Pagamento:<\/strong>[\s\S]*$/i,'').replace(/<(?:div|p)[^>]*>\s*Termini di pagamento\s*:?\s*<\/(?:div|p)>[\s\S]*$/i,'');
  if (/acconto\s*50|saldo\s*\.{2}|\[DA COMPILARE\]|\[in base al modello/i.test(retained)) throw Error('Condizioni pregresse ambigue: revisione necessaria');
  const amount = deposit == null ? 'Importo specifico del veicolo da verificare prima dell’invio.' : `${escape(deposit.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'}))} €.`;
  return `${retained}<p><strong>Pagamento:</strong> saldo alla conferma dell’ordine.</p><p><strong>Cauzione:</strong> ${amount} Da versare alla conferma dell’ordine; restituzione entro 30 giorni dalla riconsegna, salvo compensazioni documentate. La cauzione non è soggetta all’applicazione dell’IVA.</p>`;
}
export function isDepositProduct(name) {
  return /^(?:\[[^\]]+\]\s*)?(?:cauzion[ei]|deposito cauzionale|security deposit)\b/i.test(String(name || ''));
}

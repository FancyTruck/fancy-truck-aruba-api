'use strict';
const $ = id => document.getElementById(id);
let token = '', rows = [], canResolve = false;
const reasons = {
  commercial_intent_not_established: 'Richiesta commerciale non chiara',
  forward_requires_review: 'Inoltro da verificare',
  reply_without_matching_lead: 'Risposta senza una pratica identificata',
  multiple_matching_leads: 'Più pratiche compatibili',
  previous_operation_outcome_uncertain: 'Operazione interrotta: verificare cosa è già stato completato',
};
function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
function render() {
  const query = $('search').value.toLocaleLowerCase('it');
  const visible = rows.filter(row => [row.sender,row.subject,reasons[row.reason] || row.reason,row.account].join(' ').toLocaleLowerCase('it').includes(query));
  $('count').textContent = `${visible.length} messaggi da controllare`;
  $('items').replaceChildren();
  if (!visible.length) $('items').append(node('p', rows.length ? 'Nessun messaggio corrisponde alla ricerca.' : 'Non ci sono messaggi da classificare.'));
  for (const row of visible) {
    const card = document.createElement('article');
    const badge = node('span', 'Da classificare'); badge.className = 'badge';
    card.append(badge, node('h2', row.subject || 'Senza oggetto'), node('p', reasons[row.reason] || row.reason || 'Controllo necessario'));
    const fields = [['Mittente',row.sender || 'Non disponibile'],['Origine',row.account || 'Non disponibile'],['Registrato',row.created_at ? new Date(row.created_at).toLocaleString('it-IT') : 'Non disponibile']];
    if (row.candidate_ids?.length) fields.push(['Pratiche candidate',row.candidate_ids.join(', ')]);
    const dl = document.createElement('dl'); for (const [label,value] of fields) dl.append(node('dt',label),node('dd',value)); card.append(dl);
    const details = document.createElement('details'); details.append(node('summary','Dettagli del messaggio'));
    details.append(node('pre',row.excerpt || 'Estratto non disponibile. Consultare il messaggio originale.'));
    details.append(node('p',`Riferimento: ${row.message_id || row.uid || row.id}`)); card.append(details);
    if (canResolve) {
      const form = document.createElement('form');
      const label = node('label', 'Esito del controllo');
      const select = document.createElement('select'); label.append(select);
      select.append(Object.assign(node('option', 'Gestito manualmente in Odoo / nella posta'), { value: 'HANDLED_MANUALLY' }));
      if (!row.operation_id) select.append(Object.assign(node('option', 'Non è una richiesta commerciale'), { value: 'NOT_COMMERCIAL' }));
      const noteLabel = node('label', 'Controllo eseguito e riferimento della pratica');
      const note = document.createElement('textarea'); note.required = true; note.minLength = 10; note.maxLength = 2000; noteLabel.append(note);
      const button = node('button', 'Registra esito e chiudi'); button.type = 'submit';
      form.append(label, noteLabel, node('p', 'La chiusura registra il tuo controllo. Non invia messaggi e non ripete operazioni su Odoo.'), button);
      form.addEventListener('submit', async event => {
        event.preventDefault(); button.disabled = true;
        try {
          const response = await fetch(`/v1/classification-reviews/${encodeURIComponent(row.id)}/resolve`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution: select.value, note: note.value }),
          });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chiusura non riuscita');
          await refresh();
        } catch (error) { $('status').textContent = error.message; button.disabled = false; }
      });
      card.append(form);
    }
    $('items').append(card);
  }
}
function logout() { token = ''; rows = []; canResolve = false; $('items').replaceChildren(); $('credential').value = ''; $('search').value = ''; $('workspace').hidden = true; $('access').hidden = false; }
async function refresh() {
  $('refresh').disabled = true; $('status').textContent = 'Caricamento…';
  const current = token;
  try {
    const response = await fetch('/v1/classification-reviews', { headers: { Authorization: `Bearer ${current}` }, cache: 'no-store' });
    if (current !== token) return;
    if (response.status === 401) { logout(); throw new Error('Accesso non riuscito. Verifica la chiave.'); }
    if (!response.ok) throw new Error('Impossibile aggiornare la coda. Riprova.');
    const data = await response.json(); if (current !== token) return;
    rows = data.items; canResolve = data.can_resolve === true; $('workspace').hidden = false; $('access').hidden = true; render(); $('status').textContent = '';
  } catch (error) { if (current === token || !token) $('status').textContent = error.message; }
  finally { $('refresh').disabled = false; }
}
$('login').addEventListener('submit', event => { event.preventDefault(); token = $('credential').value.trim(); $('credential').value = ''; refresh(); });
$('refresh').addEventListener('click', refresh);
$('search').addEventListener('input', render);
$('logout').addEventListener('click', () => { logout(); $('status').textContent = 'Sessione chiusa.'; });

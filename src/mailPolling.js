import {newUidPage} from './mailUidPage.js';
export const MAX_POLL_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_SOURCE_BYTES = 10 * 1024 * 1024;
const mailProblem = (code, message) => Object.assign(new Error(message), { code });

// Checkpoint completed work OR a durably saved, recoverable review handoff.
// A review handoff never means body processing or an Odoo registration succeeded.
export async function pollMailbox({ client, account, store, parse, processMessage, now = Date.now() }) {
  const validity = String(client.mailbox?.uidValidity || '');
  if (!validity) throw new Error('UIDVALIDITY non disponibile: controllo sospeso');
  const key = `imap:${account}:checkpoint`;
  let checkpoint = store.cursor(key);
  if (!checkpoint) {
    checkpoint = {
      uidValidity: validity,
      lastUid: Number(store.cursor(`imap:${account}:last_uid`, 0)),
      initialSince: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    };
    store.setCursor(key, checkpoint);
  }
  if (checkpoint.uidValidity !== validity) {
    throw new Error('UIDVALIDITY cambiato: riconciliare la casella prima di riprendere');
  }
  // Keep date-qualified bootstrap discovery bounded, even when INTERNALDATE is
  // not ordered by UID. The scan watermark is distinct from processed lastUid.
  let scan = checkpoint.bootstrap_scan;
  if(scan&&(!Number.isSafeInteger(scan.uid)||scan.uid<0||!Number.isSafeInteger(scan.upper_uid)||scan.upper_uid<scan.uid||typeof scan.complete!=='boolean'))throw mailProblem('MAIL_BOOTSTRAP_INVALID','Checkpoint scansione non valido');
  const after = Math.max(checkpoint.lastUid, scan?.uid || 0);
  const page = await newUidPage(client, after + 1, 100, validity);
  if(!scan&&checkpoint.lastUid===0){
    scan={uid:0,upper_uid:page.upperUid,complete:false};
    checkpoint={...checkpoint,bootstrap_scan:scan};store.setCursor(key,checkpoint);
  }
  const bootstrap = scan&&!scan.complete;
  const eligible = bootstrap ? page.ids.filter(uid=>uid<=scan.upper_uid) : page.ids;
  let found=eligible;
  if(bootstrap&&eligible.length){
    const since=new Date(checkpoint.initialSince);
    if(!Number.isFinite(+since))throw mailProblem('MAIL_BOOTSTRAP_INVALID','Data iniziale non valida');
    found=await client.search({seq:page.sequence,uid:`${eligible[0]}:${eligible.at(-1)}`,since},{uid:true});
    page.unchanged();
    if(!Array.isArray(found)||found.length>eligible.length||new Set(found).size!==found.length||found.some(uid=>!eligible.includes(uid)))throw mailProblem('MAIL_BOOTSTRAP_SEARCH_INVALID','Ricerca iniziale non verificabile');
  }
  const candidates = found.slice().sort((a,b)=>a-b).slice(0,100);
  const rows = [];let failed=false;
  for (const uid of candidates) {
    try {
      page?.unchanged();
      // Inspect metadata before buffering attachments; a 150 MB email can kill a 512 MB worker.
      const metadata = await client.fetchOne(uid, { size: true, envelope: true }, { uid: true });
      if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) throw mailProblem('MESSAGE_SIZE_UNAVAILABLE', 'Dimensione messaggio non verificabile');
      page?.unchanged();
      if (metadata.size > MAX_INLINE_SOURCE_BYTES) {
        if (!metadata.envelope) throw mailProblem('MAIL_SOURCE_LIMIT', 'Messaggio grande senza metadati recuperabili: checkpoint conservato');
        const env = metadata.envelope;
        const { item } = store.queueClassification({
          source_key: JSON.stringify(['large-message', account, validity, uid]),
          account: account.split(':sent:')[0], mailbox: account.includes(':sent:') ? account.split(':sent:')[1] : 'INBOX',
          uid, uid_validity: validity, message_id: env.messageId || null,
          sender: env.from?.[0]?.address || '', subject: env.subject || '',
          excerpt: 'Messaggio conservato su Aruba. Corpo e allegati non scaricati: verifica manuale necessaria.',
          reason: 'large_message_requires_review', size: metadata.size, candidate_ids: [],
        });
        // Only advance once the recoverable review is persisted. Never mark it processed in Odoo.
        store.recordMailOutcome?.(account, validity, uid, {suspended:true,content_processed:false,review_id:item.id,reason:item.reason || "large_message_requires_review"});
        const next = { ...checkpoint, lastUid: uid };
        store.setCursor(key, next); checkpoint = next;
        rows.push({ suspended: true, content_processed: false, uid, account, review_id: item.id, reason: 'large_message_requires_review' });
        continue;
      }
      const message = await client.fetchOne(uid, { source: { start: 0, maxLength: MAX_INLINE_SOURCE_BYTES + 1 } }, { uid: true });
      if (!message?.source) throw new Error('Messaggio non disponibile: verifica necessaria');
      if (Buffer.byteLength(message.source) > MAX_INLINE_SOURCE_BYTES) throw mailProblem('MAIL_SOURCE_LIMIT', 'Messaggio oltre il limite dichiarato: checkpoint conservato');
      page?.unchanged();
      const parsed = await parse(message.source);
      const result = await processMessage(parsed, uid, validity);
      page?.unchanged();
      store.recordMailOutcome?.(account, validity, uid, {...result,message_id:parsed.messageId||null,subject:String(parsed.subject||'').slice(0,500),sender:parsed.from?.value?.[0]?.address||'',excerpt:String(parsed.text||'').slice(0,4000)});
      const next = { ...checkpoint, lastUid: uid };
      store.setCursor(key, next);
      checkpoint = next;
      rows.push({...result, uid, account});
    } catch (error) {
      try { store.recordMailOutcome?.(account, validity, uid, {retry_pending:true,error:error.message}); } catch {}
      rows.push({ suspended: true, retry_pending: true, uid, code: error?.code || 'MAIL_PROCESSING_FAILED',
        error: error instanceof Error ? error.message : 'errore sconosciuto' });
      failed=true;break;
    }
  }
  if(bootstrap&&!failed){
    page.unchanged();
    const all=found.length<=100;
    const complete=all&&(!page.more||page.ids.some(uid=>uid>scan.upper_uid)||(eligible.at(-1)||0)>=scan.upper_uid);
    const uid=complete?scan.upper_uid:all?(eligible.at(-1)||scan.uid):candidates.at(-1);
    const next={...checkpoint,bootstrap_scan:{...scan,uid,complete}};
    store.setCursor(key,next);
    if(!complete)rows.push({suspended:true,content_processed:false,account,reason:'mail_bootstrap_scan_pending'});
  }
  return rows;
}

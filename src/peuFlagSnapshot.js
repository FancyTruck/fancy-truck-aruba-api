import {randomUUID} from 'node:crypto';
import {problem,transaction} from './peuMailDb.js';

// Called inside the existing readonly IMAP mailbox lock. Sequence windows bound
// SEARCH responses by message count, even when UIDs are very sparse. No ESEARCH
// capability or mailbox-wide UID array is required by this final flag pass.
export async function reconcileFlagSnapshot({db,client,account,folder,validity}) {
 const {exists,uidNext}=client.mailbox;
 if(!Number.isSafeInteger(exists)||exists<0||exists>4294967295||
    !Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967295||exists>=uidNext)
  throw problem('mailbox_metadata_unavailable',502);
 const unchanged=()=>{
  if(client.mailbox?.exists!==exists||client.mailbox?.uidNext!==uidNext||String(client.mailbox?.uidValidity)!==validity)
   throw problem('mailbox_changed_retry',409);
 };
 unchanged();
 const table='flag_snapshot_'+randomUUID().replaceAll('-','');
 db.exec(`CREATE TEMP TABLE ${table}(uid INTEGER PRIMARY KEY,flags TEXT NOT NULL)`);
 try {
  const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?)`);
  let lastUid=0;
  for(let start=1;start<=exists;start+=200){
   const end=Math.min(start+199,exists);
   unchanged();
   const ids=await client.search({seq:`${start}:${end}`},{uid:true});
   unchanged();
   if(!Array.isArray(ids))throw problem('mail_flags_search_unavailable',502);
   if(ids.length!==end-start+1)throw problem('mail_flags_incomplete',502);
   if(ids.some(uid=>!Number.isSafeInteger(uid)||uid<=lastUid||uid>=uidNext))throw problem('message_flag_uid_mismatch',502);
   const batch=ids.sort((a,b)=>a-b),pending=new Set(batch);
   if(pending.size!==batch.length)throw problem('message_flag_uid_mismatch',502);
   lastUid=batch.at(-1);
   for await(const row of client.fetch(batch.join(','),{uid:true,flags:true},{uid:true})){
    if(!pending.delete(row.uid))throw problem('message_flag_uid_mismatch',502);
    insert.run(row.uid,JSON.stringify([...row.flags]));
   }
   unchanged();
   if(pending.size)throw problem('mail_flags_incomplete',502);
  }
  unchanged();
  transaction(db,()=>db.prepare(`UPDATE mail_messages SET
   deleted=CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE uid=mail_messages.uid) THEN 0 ELSE 1 END,
   flags=COALESCE((SELECT flags FROM ${table} WHERE uid=mail_messages.uid),flags)
   WHERE account=? AND folder=? AND validity=?`).run(account,folder,validity));
 } finally { db.exec(`DROP TABLE ${table}`); }
}

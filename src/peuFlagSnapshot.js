import {randomUUID} from 'node:crypto';
import {problem,transaction} from './peuMailDb.js';

// Called inside the existing readonly IMAP mailbox lock. Stage outside the
// business cache; publish only after every requested UID has been returned.
export async function reconcileFlagSnapshot({db,client,account,folder,validity}) {
 const ids=await client.search({all:true},{uid:true});
 const table='flag_snapshot_'+randomUUID().replaceAll('-','');
 db.exec(`CREATE TEMP TABLE ${table}(uid INTEGER PRIMARY KEY,flags TEXT NOT NULL)`);
 try {
  const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?)`);
  for(let i=0;i<ids.length;i+=200){
   const batch=ids.slice(i,i+200),pending=new Set(batch);
   if(pending.size!==batch.length||batch.some(uid=>!Number.isSafeInteger(uid)||uid<1))throw problem('message_flag_uid_mismatch',502);
   for await(const row of client.fetch(batch.join(','),{uid:true,flags:true},{uid:true})){
    if(!pending.delete(row.uid))throw problem('message_flag_uid_mismatch',502);
    insert.run(row.uid,JSON.stringify([...row.flags]));
   }
   if(pending.size)throw problem('mail_flags_incomplete',502);
  }
  transaction(db,()=>db.prepare(`UPDATE mail_messages SET
   deleted=CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE uid=mail_messages.uid) THEN 0 ELSE 1 END,
   flags=COALESCE((SELECT flags FROM ${table} WHERE uid=mail_messages.uid),flags)
   WHERE account=? AND folder=? AND validity=?`).run(account,folder,validity));
 } finally { db.exec(`DROP TABLE ${table}`); }
}

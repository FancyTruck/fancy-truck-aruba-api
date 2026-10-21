import {pollMailbox} from './mailPolling.js';
export async function pollSentMailbox({client,account,store,parse,processMessage}){
 const boxes=await client.list();
 const sent=boxes.filter(b=>b.specialUse==='\\Sent');
 if(sent.length!==1)throw Error('Cartella posta inviata non univoca: configurazione richiesta');
 const mailbox=sent[0].path;
 const lock=await client.getMailboxLock(mailbox,{readOnly:true});
 try{
  const scope=`${account}:sent:${mailbox}`;
  const key=`imap:${scope}:checkpoint`;
  if(!store.cursor(key)){
   if(!client.mailbox?.uidNext||!client.mailbox.uidValidity)throw Error('Checkpoint posta inviata non disponibile');
   store.setCursor(key,{uidValidity:String(client.mailbox.uidValidity),lastUid:Number(client.mailbox.uidNext)-1,initialSince:new Date().toISOString()});
   return {initialized:true,mailbox,rows:[]};
  }
  const rows=await pollMailbox({client,account:scope,store,parse,processMessage:(parsed,uid,validity)=>processMessage(parsed,uid,validity,mailbox)});
  return {initialized:false,mailbox,rows};
 }finally{lock.release();}
}

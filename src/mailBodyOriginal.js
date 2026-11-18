const MAX_TEXT=1024*1024;
// Select the message body rather than downloading large unrelated attachments.
function bodyParts(node,result=[]){if(!node||node.disposition==='attachment'||node.dispositionParameters?.filename||node.parameters?.name||node.type==='message/rfc822')return result;if(['text/plain','text/html'].includes(node.type))result.push(node);for(const child of node.childNodes||[])bodyParts(child,result);return result;}
export async function largeOriginal(client,uid,messageId,parse){
 const meta=await client.fetchOne(uid,{envelope:true,bodyStructure:true},{uid:true});
 if(meta?.envelope?.messageId!==messageId||!client.download)return null;
 const parts=bodyParts(meta.bodyStructure),part=parts.find(p=>p.type==='text/plain')||parts.find(p=>p.type==='text/html');if(!part)return null;
 const download=await client.download(String(uid),part.part||'1',{uid:true,maxBytes:2*MAX_TEXT+1});
 const chunks=[];let size=0,truncated=false;
 try{for await(const chunk of download.content){size+=chunk.length;if(size>MAX_TEXT){truncated=true;chunks.push(chunk.subarray(0,Math.max(0,MAX_TEXT-(size-chunk.length))));break;}chunks.push(chunk);}}finally{download.content.destroy?.();}
 if(part.size>2*MAX_TEXT)truncated=true;
 const content=Buffer.concat(chunks);let text=content.toString('utf8');
 if(part.type==='text/html'){const html=await parse(Buffer.concat([Buffer.from('Content-Type: text/html; charset=utf-8\r\n\r\n'),content]));text=html.text||'';}
 if(!text.trim())return null;
 const envelope=meta.envelope;
 return {message_id:messageId,folder:'INBOX',payload:{subject:envelope.subject||'',date:envelope.date?.toISOString?.()||null,from:envelope.from||[],text,text_truncated:truncated}};
}

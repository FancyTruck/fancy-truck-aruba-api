// Isolated synthetic burst only. No IMAP client, credentials or state file.
// Run each mode in a fresh process so OS peak RSS values remain comparable.
import {simpleParser} from 'mailparser';
import {EventEmitter} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {readBoundedMessage} from '../src/mailMessage.js';
import {createMailReadGate} from '../src/mailReadGate.js';
const mode=process.argv[2];if(!['baseline','gated'].includes(mode))throw Error('Use baseline or gated');
const text='x'.repeat(2*1024*1024),binary=Buffer.alloc(6*1024*1024,65).toString('base64');
const mime=Buffer.from('From: synthetic@example.invalid\r\nTo: synthetic@example.invalid\r\nSubject: Synthetic memory fixture\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="synthetic"\r\n\r\n--synthetic\r\nContent-Type: text/plain\r\n\r\n'+text+'\r\n--synthetic\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="synthetic.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+binary+'\r\n--synthetic--\r\n');
globalThis.fetch=()=>{throw Error('No network in this profile');};
globalThis.gc?.();
const initial=process.memoryUsage(),peak={...initial};let active=0,maxActive=0,accepted=0,rejected=0,sourceReads=0;
const sample=()=>{const now=process.memoryUsage();for(const key of ['rss','heapUsed','external','arrayBuffers'])peak[key]=Math.max(peak[key],now[key]);};
const timer=setInterval(sample,1),gate=createMailReadGate(),started=performance.now();
try{
 await Promise.all(Array.from({length:4},async()=>{
  const response=new EventEmitter(),done=mode==='gated'?gate.claim(response):()=>{};
  if(!done){rejected++;return;}accepted++;active++;maxActive=Math.max(maxActive,active);
  try{
   const parsed=await readBoundedMessage({uid:1,client:{async fetchOne(_,query){if(query.size)return {size:mime.length};sourceReads++;const source=Buffer.from(mime);sample();await setImmediate();return {source};}},parse:async source=>{sample();const parsed=await simpleParser(source);sample();return parsed;}});
   // Match the endpoint projection: attachment bytes are not serialized.
   const serialized=JSON.stringify({text:parsed.text,html:parsed.html,attachments:parsed.attachments.map(a=>({filename:a.filename,size:a.size}))});
   if(!serialized.length)throw Error('Missing response');sample();response.emit('finish');
  }finally{active--;done();}
 }));
 sample();
}finally{clearInterval(timer);}
console.log(JSON.stringify({mode,fixture:{source_bytes:mime.length,text_bytes:2*1024*1024,attachment_decoded_bytes:6*1024*1024},burst_requests:4,accepted,rejected,sourceReads,maxActive,initial,peak,os_peak_rss_bytes:process.resourceUsage().maxRSS*1024,elapsed_ms:Math.round(performance.now()-started),node:process.version,scope:'synthetic fresh-process module profile; not live OOM causation or total service budget'}));

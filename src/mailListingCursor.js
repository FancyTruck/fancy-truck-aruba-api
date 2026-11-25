import {createHmac,timingSafeEqual} from 'node:crypto';
const problem=code=>Object.assign(new Error(code),{code,status:400});
const scope=(account,options)=>JSON.stringify([account,options.limit,options.unseenOnly,options.since?.toISOString()||null]);
export function mailListingCursor(secret,now=Date.now){
 const mac=body=>{if(!secret)throw problem('mail_cursor_unavailable');return createHmac('sha256',secret).update('mail-listing-v1\0'+body).digest('base64url');};
 return {
  encode(account,options,continuation){if(!continuation)return null;const body=Buffer.from(JSON.stringify({v:1,scope:scope(account,options),...continuation,expires_at:continuation.expires_at||now()+30*60*1000})).toString('base64url');return body+'.'+mac(body);},
  decode(account,options,token){
   if(typeof token!=='string'||token.length>2048||!/^[-\w]+\.[-\w]{43}$/.test(token))throw problem('invalid_mail_cursor');
   const [body,sig]=token.split('.');if(!timingSafeEqual(Buffer.from(sig),Buffer.from(mac(body))))throw problem('invalid_mail_cursor');
   let data;try{data=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw problem('invalid_mail_cursor');}
   if(data.v!==1||data.scope!==scope(account,options)||!Number.isSafeInteger(data.expires_at)||data.expires_at<=now())throw problem('invalid_mail_cursor');
   return {snapshot:data.snapshot,end:data.end,expires_at:data.expires_at};
  }
 };
}

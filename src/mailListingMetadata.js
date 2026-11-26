export const LISTING_ROW_BYTES=16*1024;
export const LISTING_PAGE_BYTES=512*1024;
const TOO_LARGE=Symbol('listing_metadata_requires_review');
// Bound the selected projection BEFORE JSON serialization or retaining provider
// objects. This cannot prevent allocation already performed by the IMAP parser.
export function listingMetadata(message,uid){
 let remaining=LISTING_ROW_BYTES,nodes=0;
 const spend=n=>{remaining-=n;if(remaining<0)throw TOO_LARGE;};
 const string=s=>{if(Buffer.byteLength(s)>remaining)throw TOO_LARGE;spend(Buffer.byteLength(JSON.stringify(s)));return s;};
 const clone=(value,depth=0)=>{
  if(++nodes>512||depth>6)throw TOO_LARGE;
  if(value===null||value===undefined){spend(4);return null;}
  if(typeof value==='string')return string(value);
  if(typeof value==='boolean'){spend(value?4:5);return value;}
  if(typeof value==='number'){const n=Number.isFinite(value)?value:null;spend(String(n).length);return n;}
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw TOO_LARGE;return string(value.toISOString());}
  if(Array.isArray(value)){
   if(value.length>256)throw TOO_LARGE;spend(2+Math.max(0,value.length-1));return value.map(v=>clone(v,depth+1));
  }
  if(typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw TOO_LARGE;
  const out={};let count=0;spend(2);
  for(const key in value)if(Object.hasOwn(value,key)&&value[key]!==undefined){if(++count>64)throw TOO_LARGE;string(key);spend(1+(count>1?1:0));Object.defineProperty(out,key,{value:clone(value[key],depth+1),enumerable:true});}
  return out;
 };
 try{
  const flags=message.flags||[];
  if(!(Array.isArray(flags)||flags instanceof Set)||(flags.size??flags.length)>128)throw TOO_LARGE;
  // The flag collection is bounded before spreading it into the projection.
  return clone({uid,subject:message.envelope?.subject||null,date:message.envelope?.date||message.internalDate||null,
   from:message.envelope?.from||[],to:message.envelope?.to||[],flags:[...flags],size:message.size,metadata_complete:true});
 }catch(error){if(error!==TOO_LARGE)throw error;return metadataReview(uid,message.size);}
}
export function metadataReview(uid,size){return {uid,subject:null,date:null,from:[],to:[],flags:[],size,metadata_complete:false,metadata_status:'requires_metadata_review'};}

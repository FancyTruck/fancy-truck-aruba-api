import { createHash } from 'node:crypto';
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function problem(code,status=400){return Object.assign(new Error(code),{status,code});}
export async function jsonRequest(fetcher,url,options={}) {
  let response;
  try { response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(12000),...options}); }
  catch {throw problem('transport_unknown',503);}
  if(!response.ok)throw problem('provider_'+response.status,response.status);
  if(response.status===204)return {};
  try{return await response.json();}catch{throw problem('invalid_provider_response',502);}
}
export function allowed(db,account,kind,id,write=false){
  const row=db.prepare('SELECT * FROM allowed_resources WHERE account_id=? AND kind=? AND external_id=?').get(account,kind,id);
  if(!row || (write&&!row.writable))throw problem('resource_not_authorized',403);
  return row;
}
export function freshness(db,id,status,cursor=null,error=null){
  db.prepare('INSERT INTO source_state VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cursor=coalesce(excluded.cursor,source_state.cursor),checked_at=excluded.checked_at,error_code=excluded.error_code').run(id,status,cursor,new Date().toISOString(),error);
}


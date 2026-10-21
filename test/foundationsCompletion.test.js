import test from 'node:test';
import assert from 'node:assert/strict';
import { accessControl } from '../src/accessControl.js';
import { buildBriefing } from '../src/briefing.js';
import { encryptState,decryptState,runExternalBackup } from '../src/externalBackup.js';
const state=()=>({version:1,idempotency:{},actions:{},cases:{},integrations:{},cursors:{},classification_reviews:{},mail_operations:{},events:[],cycles:[]});
test('separate approval and execution roles cannot be bypassed with automation or admin token',()=>{
 const keys={API_TOKEN:'admin',REVIEW_READ_TOKEN:'reader',REVIEW_WRITE_TOKEN:'reviewer',AUTOMATION_TOKEN:'automation',APPROVER_TOKEN:'approver',EXECUTOR_TOKEN:'executor',SEPARATE_APPROVAL_ROLES:'true'};
 const gate=accessControl(keys);
 const can=(token,method,path)=>{let passed=false;gate({headers:{authorization:`Bearer ${token}`},method,originalUrl:path},{status(){return this},json(){}},()=>{passed=true});return passed;};
 for(const token of ['admin','reader','reviewer','automation','executor'])assert.equal(can(token,'POST','/v1/approvals/id/confirm'),false);
 assert(can('approver','POST','/v1/approvals/id/confirm'));
 for(const path of ['/v1/approvals/id/confirm/','/V1/APPROVALS/ID/CONFIRM','/v1/actions/id/execute/'])assert(!can('admin','POST',path));
 assert(!can('approver','POST','/v1/actions/id/execute'));assert(can('executor','POST','/v1/actions/id/execute'));
 assert(can('reader','GET','/v1/briefing'));assert(!can('reader','POST','/v1/automation/run'));
 assert(!can('revoked','GET','/v1/briefing'));
 assert.throws(()=>accessControl({...keys,APPROVER_TOKEN:'automation'}));
 assert.throws(()=>accessControl({...keys,APPROVER_TOKEN:undefined}));
});
test('briefing uses only reads, reports partial failures and leaves state unchanged',async()=>{
 const s=state(), before=JSON.stringify(s);
 const report=await buildBriefing({state:s,call:async(model,method)=>{
  assert(['search_count','search_read'].includes(method));
  if(model==='crm.lead')throw Error('token secret must not leak');return method==='search_count'?25:[{id:1,name:'S00331'}];
 }});
 assert.equal(report.complete,false);assert.equal(report.sections.opportunities.count,null);
 assert(report.sections.quotations.truncated);assert(!JSON.stringify(report).includes('token secret'));
 assert.equal(JSON.stringify(s),before);
});
test('encrypted backup round-trip validates schema and rejects tampering or wrong key',()=>{
 const s=state(),key='a'.repeat(64),bytes=encryptState(s,key);
 assert.deepEqual(decryptState(bytes,key),s);
 assert(!bytes.toString().includes('classification_reviews'));
 assert.throws(()=>decryptState(bytes,'b'.repeat(64)));
 const box=JSON.parse(bytes);box.data=Buffer.from('broken').toString('base64');assert.throws(()=>decryptState(Buffer.from(JSON.stringify(box)),key));
});
test('external backup verifies downloaded copy before recording success and deleting old managed backup',async()=>{
 const s=state();let uploaded;const calls=[];let marked=false;
 const old='fancy-ai-state-v1/2020-01-01T00-00-00-000Z-abc.json.enc';
 const client={async send(c){calls.push(c.constructor.name);if(c.constructor.name==='ListObjectsV2Command')return {Contents:[{Key:old,LastModified:new Date('2020-01-01'),Size:12},{Key:'unrelated.txt',LastModified:new Date('2020-01-01'),Size:1}]};
 if(c.constructor.name==='PutObjectCommand'){uploaded=c.input.Body;return {};}
 if(c.constructor.name==='GetObjectCommand')return {Body:{transformToByteArray:async()=>uploaded}};
 if(c.constructor.name==='DeleteObjectCommand'){assert(marked);assert.equal(c.input.Key,old);return {};}
 }};
 const store={has:()=>false,snapshot:()=>s,remember(){marked=true;}};
 const r=await runExternalBackup({client,store,env:{EXTERNAL_BACKUP_ENABLED:'true',BACKUP_S3_BUCKET:'test',BACKUP_ENCRYPTION_KEY:'a'.repeat(64)}});
 assert.equal(r.status,'VERIFIED');assert.deepEqual(calls,['ListObjectsV2Command','PutObjectCommand','GetObjectCommand','DeleteObjectCommand']);
});
test('failed download never marks backup verified or deletes old copies',async()=>{
 const store={has:()=>false,snapshot:state,remember(){throw Error('must not mark success');}};
 const client={async send(c){if(c.constructor.name==='ListObjectsV2Command')return {};if(c.constructor.name==='PutObjectCommand')return {};throw Error('download failed');}};
 await assert.rejects(runExternalBackup({client,store,env:{EXTERNAL_BACKUP_ENABLED:'true',BACKUP_S3_BUCKET:'test',BACKUP_ENCRYPTION_KEY:'a'.repeat(64)}}),/download failed/);
});
test('briefing serializes reads and retries only rate-limited reads with bounded delay',async()=>{
 let active=0,maxActive=0,attempts=0;const sleeps=[];
 const report=await buildBriefing({state:state(),sleep:async ms=>sleeps.push(ms),call:async(_model,method)=>{
  active++;maxActive=Math.max(maxActive,active);
  await Promise.resolve();active--;attempts++;
  if(attempts===1)throw Object.assign(Error('HTML rate limit'),{status:429,retryAfterMs:1500});
  return method==='search_count'?0:[];
 }});
 assert(report.complete);assert.equal(maxActive,1);assert.equal(attempts,7);assert(sleeps.includes(1500));
});
test('briefing stops after bounded 429 retries and never retries permission failures',async()=>{
 for(const status of [429,403]){
  let calls=0;
  const report=await buildBriefing({state:state(),sleep:async()=>{},call:async()=>{calls++;throw Object.assign(Error('secret'),{status});}});
  assert(!report.complete);assert.equal(calls,status===429?9:3);
  assert(!JSON.stringify(report).includes('secret'));
 }
 let calls=0;
 await buildBriefing({state:state(),sleep:async()=>{},call:async()=>{calls++;throw Object.assign(Error('wait'),{status:429,retryAfterMs:60000});}});
 assert.equal(calls,3);
});

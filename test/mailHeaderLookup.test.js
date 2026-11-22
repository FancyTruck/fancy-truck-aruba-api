import test from 'node:test';import assert from 'node:assert/strict';
import {headerCandidates} from '../src/mailHeaderLookup.js';import {reconcileSent} from '../src/peuMailSync.js';
function fixture(exists=450,matches=[420]){
 const queries=[];let released=0;
 const client={mailbox:{exists,uidNext:exists*1000+1,uidValidity:'synthetic'},
 async search(q,o){queries.push(q);assert.deepEqual(o,{uid:true});assert.equal(q.header['message-id'],'<exact@example.invalid>');assert(q.seq);const [a,b]=q.seq.split(':').map(Number);assert(b-a<200);return matches.filter(n=>n>=a&&n<=b).map(n=>n*1000);},
 async fetchOne(uid){return {uid,envelope:{messageId:'<exact@example.invalid>'}};},
 async getMailboxLock(folder,options){assert.equal(folder,'Sent');assert.equal(options.readOnly,true);return {release(){released++;}};}};
 return {client,queries,get released(){return released;}};
}
const id='<exact@example.invalid>';
test('sparse exact-header candidate beyond first windows is found with bounded queries',async()=>{const f=fixture();assert.deepEqual((await headerCandidates(f.client,id)).ids,[420000]);assert.deepEqual(f.queries.map(q=>q.seq),['1:200','201:400','401:450']);});
test('empty mailbox does not SEARCH',async()=>{const f=fixture(0,[]);assert.deepEqual((await headerCandidates(f.client,id)).ids,[]);assert.equal(f.queries.length,0);});
for(const mode of ['false','duplicate','foreign','changed'])test(`invalid ${mode} search refuses receipt and releases readonly lock`,async()=>{
 const f=fixture();f.client.search=async()=>{if(mode==='changed')f.client.mailbox.exists++;return mode==='false'?false:mode==='duplicate'?[1000,1000]:mode==='foreign'?[999999999]:[];};
 await assert.rejects(reconcileSent(f.client,'Sent',id));assert.equal(f.released,1);
});
test('work limit cannot report false absence or accepted receipt',async()=>{const f=fixture(20001,[]);await assert.rejects(reconcileSent(f.client,'Sent',id),{code:'mail_header_lookup_incomplete'});assert.equal(f.queries.length,100);assert.equal(f.released,1);});
test('multiple candidates are unresolved without fetching or re-sending',async()=>{const f=fixture(450,[10,420]);f.client.fetchOne=()=>assert.fail('No fetch for ambiguity');const r=await reconcileSent(f.client,'Sent',id);assert.equal(r.status,'unresolved');assert.equal(r.uids.length,2);assert.equal(f.released,1);});
for(const mode of ['substring','wrongUid','exact'])test(`sent reconciliation requires exact unique envelope: ${mode}`,async()=>{const f=fixture();f.client.fetchOne=async uid=>({uid:mode==='wrongUid'?uid+1:uid,envelope:{messageId:mode==='substring'?'<other@example.invalid>':id}});const r=await reconcileSent(f.client,'Sent',id);assert.equal(r.status,mode==='exact'?'verified_sent':'unresolved');assert.equal(f.released,1);});
test('invalid message ID refuses before SEARCH and still releases lock',async()=>{const f=fixture();await assert.rejects(reconcileSent(f.client,'Sent','bad\nheader'));assert.equal(f.queries.length,0);assert.equal(f.released,1);});

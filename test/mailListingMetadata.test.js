import test from 'node:test';import assert from 'node:assert/strict';
import {listingMetadata,LISTING_ROW_BYTES,LISTING_PAGE_BYTES} from '../src/mailListingMetadata.js';import {listMailboxMessages} from '../src/mailListing.js';
const small={uid:1000,seq:1,size:0,envelope:{subject:'Synthetic',from:[{address:'sender@example.invalid',name:'Name'}],to:[],date:new Date('2026-11-26')},flags:new Set(['\\Seen'])};
const bytes=v=>Buffer.byteLength(JSON.stringify(v));
test('small metadata retains exact values, zero size and date JSON with detached projection',()=>{const r=listingMetadata(small,1000);assert.equal(r.subject,'Synthetic');assert.equal(r.date,'2026-11-26T00:00:00.000Z');assert.equal(r.size,0);assert.deepEqual(r.flags,['\\Seen']);assert.equal(r.metadata_complete,true);assert.notEqual(r.from,small.envelope.from);assert(bytes(r)<=LISTING_ROW_BYTES);});
for(const kind of ['subject','addresses','unicode','escaping','flags','nested','cycle'])test(`oversized ${kind} becomes explicit review without changing provider source`,()=>{
 const m={...small,envelope:{...small.envelope},flags:new Set(small.flags)};
 if(kind==='subject')m.envelope.subject='x'.repeat(LISTING_ROW_BYTES+1);
 if(kind==='addresses')m.envelope.from=Array.from({length:257},()=>({address:'a@example.invalid'}));
 if(kind==='unicode')m.envelope.subject='😀'.repeat(5000);
 if(kind==='escaping')m.envelope.subject='\0'.repeat(4000);
 if(kind==='flags')m.flags=new Set(Array.from({length:129},(_,i)=>'flag'+i));
 if(kind==='nested'){let a='deep';for(let i=0;i<8;i++)a=[a];m.envelope.from=a;}
 if(kind==='cycle'){const a={};a.child=a;m.envelope.from=[a];}
 const r=listingMetadata(m,1000);assert.equal(r.metadata_complete,false);assert.equal(r.metadata_status,'requires_metadata_review');assert.equal(r.uid,1000);assert.equal(r.size,0);assert(bytes(r)<512);assert.notEqual(m.envelope.subject,null);
});
test('100 metadata-rich messages stay inside aggregate512KiB; overflow is explicit, cursor still progresses',async()=>{
 const client={mailbox:{exists:100,uidNext:100001,uidValidity:'1'},search:async()=>Array.from({length:100},(_,i)=>(i+1)*1000),fetchOne:async uid=>({...small,uid,seq:uid/1000,envelope:{...small.envelope,subject:'s'.repeat(12000)}})};
 const r=await listMailboxMessages(client,{limit:100});assert.equal(r.messages.length,100);assert.equal(r.metadata_complete,false);assert(r.messages.some(m=>m.metadata_complete));assert(r.messages.some(m=>!m.metadata_complete));assert.equal(r.metadata_bytes,bytes(r.messages));assert(bytes(r.messages)<=LISTING_PAGE_BYTES);assert.equal(r.continuation,null);assert.equal(new Set(r.messages.map(m=>m.uid)).size,100);
});
test('metadata review rows preserve continuation inside overflowing search window',async()=>{
 const client={mailbox:{exists:3,uidNext:3001,uidValidity:'1'},search:async q=>{const [a,b]=q.seq.split(':').map(Number);return [1000,2000,3000].filter(uid=>uid/1000>=a&&uid/1000<=b);},fetchOne:async uid=>({...small,uid,seq:uid/1000,envelope:{subject:'x'.repeat(20000)}})};
 const first=await listMailboxMessages(client,{limit:2});assert.deepEqual(first.messages.map(m=>m.uid),[3000,2000]);assert.equal(first.metadata_complete,false);const next=await listMailboxMessages(client,{limit:2,resume:first.continuation});assert.deepEqual(next.messages.map(m=>m.uid),[1000]);assert.equal(next.continuation,null);
});

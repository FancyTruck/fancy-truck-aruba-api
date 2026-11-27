import test from 'node:test';
import assert from 'node:assert/strict';
import {teamAlreadyReplied} from '../src/teamReplyGuard.js';
import {replyCycleEvidence} from '../src/replyCycleEvidence.js';
import {automaticDraftVerifier} from '../src/automaticDraftVerifier.js';
const id='<request@example.invalid>',sender='client@example.invalid';
function fixture({headers=Buffer.from('References: '+id),envelope={},full={},parsed={},source=Buffer.from('synthetic')}={}) {
 let folder,released=0,bodies=0,parses=0,connections=0;
 const args={parsed:{messageId:id,date:new Date('2026-11-20'),from:{value:[{address:sender}]},...parsed},accounts:['hello'],evidence:true,
  withImap:async(account,fn)=>{connections++;return fn({mailbox:{exists:1,uidNext:10,uidValidity:'1'},list:async()=>[{path:'Sent',specialUse:'\\Sent'}],
   getMailboxLock:async(path,opts)=>{assert.equal(opts.readOnly,true);folder=path;return {release(){released++;}};},
   search:async()=>folder==='Sent'?[1]:[],fetchOne:async(uid,q)=>{
    if(q.size)return {size:20};
    if(q.source){bodies++;return {source};}
    return {uid,headers,envelope:{inReplyTo:id,date:new Date('2026-11-21'),from:[{address:'hello@fancytruck.it'}],to:[{address:sender}],...envelope}};
   }});},
  parse:async()=>{parses++;return {inReplyTo:id,messageId:'<answer@example.invalid>',date:new Date('2026-11-21'),text:'Synthetic answer',...full};}};
 return {args,get released(){return released;},get bodies(){return bodies;},get parses(){return parses;},get connections(){return connections;}};
}
const incomplete={code:'team_reply_payload_incomplete',status:502};
test('oversized header rejects before decoding or fetching body even with exact envelope ancestry',async()=>{
 const headers=Buffer.alloc(64*1024+1,65);headers.toString=()=>assert.fail('oversized buffer must not be decoded');
 const f=fixture({headers});await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.released,1);assert.equal(f.bodies,0);
});
test('UTF8 header byte budget applies before unfolding and matching',async()=>{
 const f=fixture({headers:'References: '+id+'\r\n '+ '€'.repeat(23000)});await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.parses,0);assert.equal(f.released,1);
});
test('exact ancestry near header boundary remains usable without truncation',async()=>{
 const prefix='References: ',headers=prefix+' '.repeat(64*1024-prefix.length-id.length)+id;
 const f=fixture({headers,envelope:{inReplyTo:undefined}});assert.equal((await teamAlreadyReplied(f.args)).handled,true);assert.equal(f.released,2);
});
test('bounded folded references preserve exact token relation and reject substring relation',async()=>{
 const f=fixture({headers:'References: <older@example.invalid>\r\n\t'+id,envelope:{inReplyTo:undefined}});assert.equal((await teamAlreadyReplied(f.args)).handled,true);
 const other=fixture({headers:'References: <prefixrequest@example.invalid>',envelope:{inReplyTo:undefined}});assert.deepEqual(await teamAlreadyReplied(other.args),{handled:false});
});
test('combined To/Cc count cannot silently drop the customer at its end',async()=>{
 const f=fixture({envelope:{to:Array.from({length:100},()=>({address:'pietro@fancytruck.it'})),cc:[{address:sender}]}});
 await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.bodies,0);assert.equal(f.released,1);
});
test('recipient byte budget is independent of list count',async()=>{
 const f=fixture({envelope:{to:[{address:sender},...Array.from({length:40},()=>({address:'a'.repeat(900)+'@example.invalid'}))]}});
 await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.bodies,0);
});
test('oversized customer metadata fails before any connection',async()=>{
 const f=fixture({parsed:{from:{value:Array.from({length:101},()=>({address:sender}))}}});await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.connections,0);
});
test('unsupported header/address payload and invalid related date cannot establish proof',async()=>{
 for(const options of [{headers:{toString:()=>id}},{envelope:{from:[{address:{toString:()=> 'hello@fancytruck.it'}}]}},{envelope:{to:'unsupported'}},{envelope:{date:'invalid'}}]){
  const f=fixture(options);await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.released,1);assert.equal(f.bodies,0);
 }
});
test('oversized UTF8 or unsupported source cannot reach the MIME parser',async()=>{
 for(const source of ['€'.repeat(800000),{length:10},Buffer.alloc(0)]){
  const f=fixture({source});await assert.rejects(teamAlreadyReplied(f.args),/team_reply_body_unavailable/);assert.equal(f.parses,0);assert.equal(f.released,1);
 }
});
test('oversized parsed evidence rejects instead of retaining or truncating a claimed answer',async()=>{
 const f=fixture({full:{text:'x'.repeat(256*1024+1)}});await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.parses,1);assert.equal(f.released,1);
});
test('evidence budget uses UTF8 bytes and preserves exact boundary text',async()=>{
 const bad=fixture({full:{text:'€'.repeat(90000)}});await assert.rejects(teamAlreadyReplied(bad.args),incomplete);
 const text='€'.repeat(87381)+'x',f=fixture({full:{text}});assert.equal(Buffer.byteLength(text),256*1024);assert.equal((await teamAlreadyReplied(f.args)).evidence.text,text);
});
test('malformed or oversized parsed message identity cannot become evidence',async()=>{
 for(const messageId of ['x'.repeat(999),'<answer>\r\nInjected: yes',{toString:()=>'<answer>'}]){
  const f=fixture({full:{messageId}});await assert.rejects(teamAlreadyReplied(f.args),incomplete);assert.equal(f.released,1);
 }
});
test('readonly cycle consumer propagates incomplete evidence even when a local receipt exists',async()=>{
 const f=fixture({full:{text:'x'.repeat(256*1024+1)}});
 const actions={a:{type:'SEND_EMAIL',status:'EXECUTED',payload:{account:'hello',inReplyTo:id,to:sender,text:'Answer'},executed_at:'2026-11-21T00:00:00Z',result:{accepted:[sender],rejected:[],message_id:'<sent>'}}},before=JSON.stringify(actions);
 await assert.rejects(replyCycleEvidence({account:'hello',messageId:id,sender,actions,
  readOriginal:async()=>({original:{message_id:id,payload:{text:'Request',from:[{address:sender}]}}}),
  teamCheck:async(parsed,evidence)=>teamAlreadyReplied({...f.args,parsed,evidence})}),incomplete);
 assert.equal(JSON.stringify(actions),before);assert.equal(f.released,1);
});
test('actual draft verifier defers oversized header check without retiring or authorizing the draft',async()=>{
 const f=fixture({headers:'x'.repeat(64*1024+1)}),events=[];
 const action={id:'synthetic',status:'PENDING_APPROVAL',target:sender,payload:{account:'hello',inReplyTo:id}},before=JSON.stringify(action);
 const verify=automaticDraftVerifier({readOriginal:async()=>({original:{payload:{text:'Request',from:[{address:sender}]}}}),classify:()=>({kind:'rental'}),
  teamCheck:parsed=>teamAlreadyReplied({...f.args,parsed,evidence:false}),store:{save:()=>assert.fail('No retirement'),audit:(...event)=>events.push(event)},log(){}});
 await assert.rejects(verify(action),{code:'team_reply_payload_incomplete'});assert.equal(JSON.stringify(action),before);
 assert.deepEqual(events,[['AUTO_DRAFT_VERIFICATION_DEFERRED',{action_id:'synthetic',reason:'team_reply_payload_incomplete'}]]);assert.equal(f.released,1);
});

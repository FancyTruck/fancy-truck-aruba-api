import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticDraftVerifier} from '../src/automaticDraftVerifier.js';
import {classifyCommercialMessage} from '../src/commercialFilter.js';
function fixture({customer='customer@example.invalid',missing=false,team=false,internal=false,administrative=false}={}){
 const action={id:'draft',status:'PENDING_APPROVAL',case_id:'odoo-lead-222',target:'customer@example.invalid',payload:{account:'hello',inReplyTo:'<source>'}};
 const original={message_id:'<source>',source:'odoo_received',case_id:222,odoo_message_id:10,payload:{subject:'Re: Dettagli evento',text:'Consegna a Milano il 20/12/2026 alle 09:00 e ritiro il 22/12/2026 alle 18:00.',from:[{address:'customer@example.invalid'}]}};
 const verify=automaticDraftVerifier({readOriginal:async()=>({original}),classify:(s,t)=>classifyCommercialMessage(s,t,new Map(),{isReply:true}),teamCheck:async()=>({handled:team}),store:{save(){},audit(){}},log(){},odooRead:async(model,domain)=>{
  if(model==='crm.lead'){assert.deepEqual(domain[0],['id','=',222]);return missing?[]:[{id:222,name:administrative?'Configurazione Odoo':'Richiesta noleggio Airstream',description:administrative?'Passaggio a Odoo':'Vorremmo noleggiare un Airstream per un evento.',email_from:customer}];}
  if(model==='mail.message')return internal?[{email_from:'hello@fancytruck.it',parent_id:[10,'Original']}]:[];
  throw Error('unexpected read');
 }});return {action,verify};
}
test('factual customer follow-up is verified through its exact commercial case',async()=>{const f=fixture();assert.equal(await f.verify(f.action),true);assert.equal(f.action.status,'PENDING_APPROVAL');});
for(const options of [{missing:true},{customer:'other@example.invalid'},{administrative:true}])test('uncertain or unrelated CRM evidence preserves a blocked draft '+JSON.stringify(options),async()=>{const f=fixture(options);await assert.rejects(f.verify(f.action),{code:'draft_commercial_context_required'});assert.equal(f.action.status,'PENDING_APPROVAL');assert.equal(f.action.cancel_reason,undefined);});
test('internal-only Odoo handoff never establishes customer delivery',async()=>{const f=fixture({internal:true});await assert.rejects(f.verify(f.action),{code:'draft_team_reply_unverified'});assert.equal(f.action.status,'PENDING_APPROVAL');});
test('recipient-aware mailbox evidence can retire a genuinely answered draft',async()=>{const f=fixture({internal:true,team:true});assert.equal(await f.verify(f.action),false);assert.equal(f.action.cancel_reason,'TEAM_ALREADY_REPLIED');});

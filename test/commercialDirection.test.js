import test from 'node:test';import assert from 'node:assert/strict';
import {classifyCommercialMessage as classify} from '../src/commercialFilter.js';
import {routeCommercialMessage} from '../src/commercialRouting.js';
const samples=[
 ['Energia a bordo per il viaggio','Una soluzione per il catering e il tuo truck: scopri il riscaldamento e richiedi informazioni.'],
 ['Che impresa è la tua? Scopri quanto credito puoi ottenere','Richiedi informazioni per finanziare il noleggio del tuo food truck.'],
 ['Business plan: 30 minuti gratuiti per parlarne','Una consulenza per il tuo catering, richiedi informazioni.'],
 ['Re: Richiesta noleggio','Presso la filiale il generatore attualmente disponibile per il vostro cantiere è in allegato. Resto in attesa per procedere con la redazione del preventivo.'],
 ['Re: Richiesta noleggio','In risposta alla vostra richiesta, il nostro generatore è disponibile. Desiderate procedere con la redazione del preventivo?'],
];
for(const [subject,text] of samples)test(`non-customer purpose reviewed before finding/creating a CRM lead: ${subject}`,async()=>{
 let queued=0,lookups=0;const result=await routeCommercialMessage({parsed:{subject,text,from:{value:[{address:'supplier@example.test'}]},headers:new Map()},uid:1,account:'synthetic',uidValidity:'1',store:{queueClassification(row){queued++;assert.equal(row.reason,'non_customer_direction_requires_review');return {item:{id:'review-fixture'},duplicate:false};}},findLead:async()=>{lookups++;return {lead:{id:123},order_ids:[]};}});
 assert.equal(result.action,'review');assert.equal(queued,1);assert.equal(lookups,0);
});
for(const [subject,text,kind] of [
 ['Richiesta noleggio','Vorrei noleggiare un food truck per un evento a Milano.','rental'],
 ['Brand activation per una banca','Vorremmo un preventivo per un roadshow sul credito alle imprese.','brand_activation'],
 ['Richiesta catering','Cerchiamo un catering per la filiale di una banca.','catering'],
 ['Re: Preventivo Airstream','Confermiamo il vostro preventivo per il noleggio del food truck.','rental'],
 ['Richiesta acquisto food truck','Vorrei acquistare un food truck con un finanziamento.','sale'],
 ])test(`preserve legitimate customer request: ${subject}`,()=>assert.equal(classify(subject,text).kind,kind));
test('mixed supplier/customer purpose remains reviewable, not silently dropped',()=>{
 assert.equal(classify('Scopri quanto credito puoi ottenere','Vorremmo noleggiare un food truck per un nostro evento.').reason,'non_customer_direction_requires_review');
});
for(const body of [
 'Vi proponiamo i nostri servizi di marketing per il noleggio food truck. Vorremmo fissare una call conoscitiva.',
 'La nostra agenzia di marketing può migliorare la visibilità del vostro catering. Richiedete un preventivo.',
 'Ti presentiamo i nostri prodotti per il noleggio. Vorrei organizzare una demo.',
])test('sales pitches requesting a meeting are not customer demand: '+body,()=>assert.equal(classify('Preventivo servizi food truck',body).reason,'supplier_offer'));

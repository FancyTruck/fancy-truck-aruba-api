import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCommercialMessage as classify} from '../src/commercialFilter.js';
import {routeCommercialMessage} from '../src/commercialRouting.js';

const pitches=[
 ['Servizi per Fancy Truck','Vorremmo proporvi i nostri servizi di marketing per il vostro catering.'],
 ['Nuovi clienti per il tuo food truck','Siamo una agenzia. Possiamo aiutarvi a acquisire nuovi clienti: prenota una call.'],
 ['Digitalizza il noleggio','La nostra piattaforma gestisce il noleggio truck. Richiedi una demo.'],
 ['Re: Preventivo food truck','Vi proponiamo una consulenza commerciale per aumentare le vostre vendite.'],
 ['Proposta SEO','Ti contatto per presentarti i nostri servizi SEO e una consulenza gratuita.'],
 ['Roadshow e personale','We offer staffing services for your roadshow. Request a quote.'],
 ['Software per la tua attività','Our software manages catering requests. Book a free demo.'],
 ['Business plan per Fancy Truck','Vorremmo offrirvi una consulenza gratuita per il vostro food truck.'],
 ['Energia a bordo per il freddo, anche durante il viaggio','Installiamo riscaldamento per il tuo truck, scopri le nostre soluzioni e richiedi un preventivo.'],
 ['Che impresa è la tua? Scopri quanto credito puoi ottenere','Richiedi informazioni sul credito per il noleggio.'],
 ['Business plan per Fancy Truck: 30 minuti gratuiti per parlarne','Richiedi una consulenza per il tuo catering.'],
];
for(const [subject,text] of pitches)test('supplier pitch bypasses CRM and review noise: '+subject,async()=>{
 assert.equal(classify(subject,text).reason,'supplier_offer');
 const decision=await routeCommercialMessage({parsed:{subject,text,inReplyTo:'<a-thread>',from:{value:[{address:'azienda@example.com'}]}},store:{queueClassification(){assert.fail('Clear supplier pitch must not enter customer queue');}},findLead(){assert.fail('Must stop before matching an existing customer/lead');}});
 assert.deepEqual(decision,{action:'skip',reason:'supplier_offer'});
});
for(const [subject,text,kind] of [
 ['Evento aziendale','Siamo una agenzia di comunicazione. Vorremmo noleggiare un food truck per un evento a Milano.','rental'],
 ['Richiesta catering','Siamo fornitori software. Cerchiamo un catering per la nostra festa aziendale.','catering'],
 ['Food truck per presentazione software','Vorrei un preventivo per noleggiare un food truck durante il lancio della nostra piattaforma.','rental'],
 ['Roadshow credito','Vorremmo un preventivo per un roadshow dedicato ai nostri servizi finanziari.','brand_activation'],
])test('vendor company can still request our services: '+subject,()=>assert.equal(classify(subject,text).kind,kind));
test('both an offered service and an explicit customer request require review',()=>{
 assert.equal(classify('Collaborazione','Offriamo servizi SEO. Vorremmo noleggiare un food truck per il nostro evento.').reason,'non_customer_direction_requires_review');
});
test('customer request hidden in quoted history cannot rescue a current supplier pitch',()=>{
 assert.equal(classify('Re: Food truck','Vorremmo offrirvi il nostro software di noleggio.\nOn Monday someone wrote:\nVorrei noleggiare un food truck.').reason,'supplier_offer');
});
test('a supplier responding to our purchase request remains operational review, never a lead',()=>{
 assert.equal(classify('Re: Richiesta noleggio','Il nostro generatore è disponibile in risposta alla vostra richiesta. Possiamo procedere con il preventivo.').reason,'non_customer_direction_requires_review');
});

test('agency presenting a real project is reviewed rather than discarded as a seller',()=>{
 assert.equal(classify('Progetto evento','Vorremmo presentarvi il brief per un evento con food truck.').reason,'non_customer_direction_requires_review');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteFormMessage} from '../src/websiteForm.js';
import {classifyCommercialMessage} from '../src/commercialFilter.js';
const form={subject:'Nuovo dato inserito: Form contatti',messageId:'<example@www.fancytruck.it>',from:{value:[{address:'hello@fancytruck.it'}]},text:'Nome e Cognome Andrea Email info@colombovino.it [info@colombovino.it] Messaggio\nAffittare food truck per eventi azienda vitivinicola\n\nInviato da Fancy Truck [https://www.fancytruck.it]'};
test('website customer is extracted before internal sender exclusion',()=>{
 const m=websiteFormMessage(form);assert.equal(m.from.value[0].address,'info@colombovino.it');assert.equal(m.from.value[0].name,'Andrea');assert.equal(m.messageId,form.messageId);assert.equal(m.originalFrom,form.from);assert.equal(classifyCommercialMessage(m.subject,m.text).kind,'rental');assert.equal(form.from.value[0].address,'hello@fancytruck.it');
});
test('ordinary internal mail, forwards, malformed forms and internal addresses stay unchanged',()=>{
 for(const m of [{...form,subject:'Fwd: '+form.subject},{...form,messageId:'<x@example.test>'},{...form,text:'Vorrei noleggiare un food truck'},{...form,text:form.text.replaceAll('info@colombovino.it','hello@fancytruck.it')},{...form,from:{value:[{address:'other@example.test'}]}}])assert.equal(websiteFormMessage(m),m);
});

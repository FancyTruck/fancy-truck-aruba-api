import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSuspension} from '../src/suspensionDescription.js';
test('business reviews retain meaningful reason and UID',()=>{
 assert.equal(describeSuspension('pietro',{uid:4330,reason:'new_thread_existing_customer'}), 'pietro UID 4330: Nuova conversazione con cliente esistente: collegamento alla pratica da verificare');
 assert.match(describeSuspension('sent:pietro',{uid:1458,reason:'outgoing_multiple_recipients'}),/più destinatari/);
});
test('technical error, unknown reason and legacy missing fields remain diagnosable',()=>{
 assert.equal(describeSuspension('hello',{uid:7,error:'IMAP down',reason:'x'}),'hello UID 7: IMAP down');
 assert.match(describeSuspension('odoo',{reason:'new_code'}),/new_code/);
 assert.equal(describeSuspension('pietro',{}),'pietro: Revisione necessaria: motivo non disponibile');
 assert.match(describeSuspension('pietro',{review_id:'abc'}),/revisione abc/);
});

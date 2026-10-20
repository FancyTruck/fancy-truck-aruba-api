import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonStateStore } from '../src/store.js';
import { accessControl } from '../src/accessControl.js';
import { backupState, restoreState } from '../src/stateBackup.js';
function setup(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'fancy-lifecycle-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true})); return { dir, store: new JsonStateStore(path.join(dir,'state.json')) }; }
test('review closure persists audit details without re-running uncertain operations', t => {
  const {store}=setup(t);
  const {item}=store.queueClassification({source_key:'one',operation_id:'op',reason:'previous_operation_outcome_uncertain'});
  store.saveMailOperation('op',{status:'STARTED'});
  assert.throws(() => store.resolveClassification(item.id,'NOT_COMMERCIAL','Controllo effettuato','reviewer'));
  assert.throws(() => store.resolveClassification(item.id,'HANDLED_MANUALLY','ok','reviewer'));
  store.resolveClassification(item.id,'HANDLED_MANUALLY','Controllata e completata pratica CRM 42','reviewer');
  const restored=new JsonStateStore(store.filePath);
  assert.equal(restored.state.classification_reviews[item.id].status,'RESOLVED');
  assert.equal(restored.state.mail_operations.op.status,'STARTED');
  assert.throws(() => restored.resolveClassification(item.id,'HANDLED_MANUALLY','Seconda chiusura','reviewer'));
});
test('roles restrict readers and reviewers to their explicit operations', () => {
  const middleware=accessControl({API_TOKEN:'admin',REVIEW_READ_TOKEN:'read',REVIEW_WRITE_TOKEN:'write'});
  function check(token,method,url) { let status=200,passed=false; middleware({headers:{authorization:`Bearer ${token}`},method,originalUrl:url}, {status(code){status=code;return this;},json(){}},()=>{passed=true;});return {status,passed}; }
  assert.equal(check('read','GET','/v1/classification-reviews').passed,true);
  assert.equal(check('read','GET','/v1/accounts').status,403);
  assert.equal(check('write','POST',`/v1/classification-reviews/${'a'.repeat(64)}/resolve`).passed,true);
  assert.equal(check('read','POST',`/v1/classification-reviews/${'a'.repeat(64)}/resolve`).status,403);
  assert.equal(check('write','POST','/v1/hello/send').status,403);
  assert.equal(check('expired','GET','/v1/classification-reviews').status,401);
  assert.throws(()=>accessControl({API_TOKEN:'same',REVIEW_READ_TOKEN:'same'}));
});
test('backup restores checkpoints and unresolved operations; tampering and overwrite fail', t => {
  const {dir,store}=setup(t);store.setCursor('imap:hello:checkpoint',{lastUid:42});store.saveMailOperation('pending',{status:'STARTED'});
  store.queueClassification({source_key:'pending',reason:'uncertain'});
  const backup=path.join(dir,'backup.json'), restored=path.join(dir,'restored.json');
  backupState(store,backup);restoreState(backup,restored);
  assert.deepEqual(new JsonStateStore(restored).snapshot(),store.snapshot());
  assert.throws(()=>restoreState(backup,restored),{code:'EEXIST'});
  const envelope=JSON.parse(fs.readFileSync(backup,'utf8'));envelope.payload+=' ';fs.writeFileSync(backup,JSON.stringify(envelope));
  assert.throws(()=>restoreState(backup,path.join(dir,'invalid.json')),/Integrità/);
});

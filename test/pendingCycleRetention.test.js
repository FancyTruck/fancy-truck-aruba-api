import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {JsonStateStore} from '../src/store.js';
import {ApprovalService} from '../src/policy.js';
import {makePeuContract} from '../src/peuContract.js';
import {openMailDb} from '../src/peuMailDb.js';
import {captureBundle,sealBundle,privateDirectory,removePrivateDirectory} from '../src/backupBundle.js';
import {isolatedBackupRestore} from '../src/isolatedBackupRestore.js';
import {applyRecoveryGuard} from '../src/recoveryGuard.js';
import {assertWritable} from '../src/runtime.js';
function fixture(t){const directory=privateDirectory('pending-cycle-');t.after(()=>removePrivateDirectory(directory));return {directory,store:new JsonStateStore(path.join(directory,'state.json'))};}
function history(store,count){const cycle=store.beginCycle(['synthetic']);store.state.cycles.push(...Array.from({length:count},(_,i)=>({id:`synthetic-terminal-${i}`,status:'COMPLETED'})));return cycle;}
test('state save/load retains old RUNNING cycle and only recent terminal history until recovery completes',t=>{
 const {store}=fixture(t);store.setCursor('synthetic',{lastUid:12});const pending=history(store,205);store.save();
 assert.equal(store.state.cycles[0],pending);assert.equal(store.state.cycles.length,201);assert.equal(store.state.cycles.at(-1).id,'synthetic-terminal-204');
 const reader=new JsonStateStore(store.filePath);assert.equal(reader.state.cycles[0].id,pending.id);assert.equal(reader.state.cycles[0].status,'RUNNING');assert.equal(reader.state.cycles.length,201);
 assert.equal(reader.reconcileInterruptedCycles(),1);assert.equal(reader.state.cycles.length,200);assert.equal(reader.state.cycles.some(c=>c.status==='RUNNING'),false);
 assert.equal(reader.state.events.at(-1).cycle_ids[0],pending.id);assert.deepEqual(reader.state.cursors,{synthetic:{lastUid:12}});
});
for(const phase of ['writeFileSync','renameSync'])test(`${phase}: pending-cycle retention and failed compaction rollback survive retry`,t=>{
 const {store}=fixture(t),pending=history(store,205),cycles=store.state.cycles,before=store.snapshot();const real=fs[phase];fs[phase]=(...args)=>{if(String(args[0]).startsWith(store.filePath))throw Error('Synthetic retention disk failure');return real(...args);};
 try{assert.throws(()=>store.save(),/disk failure/);}finally{fs[phase]=real;}
 assert.equal(store.state.cycles,cycles);assert.deepEqual(store.snapshot(),before);assert.equal(pending.status,'RUNNING');store.save();assert.equal(new JsonStateStore(store.filePath).state.cycles[0].id,pending.id);
});
test('backup capture retains old RUNNING cycle, seals and decrypts it in an isolated quarantined restore',async t=>{
 const {directory,store}=fixture(t);const db=openMailDb(path.join(directory,'peu-aruba.sqlite'));t.after(()=>db.close());makePeuContract({db,approvals:new ApprovalService(store,'synthetic-only'),assertWritable:()=>{throw Error('No external writes');}});
 const pending=history(store,35);store.setCursor('synthetic',{lastUid:12});store.state.actions.synthetic={id:'synthetic',status:'UNCERTAIN',execution:{kind:'smtp',id:'synthetic-attempt'}};store.save();const original=store.snapshot(),bytes=fs.readFileSync(store.filePath,'utf8');
 const captureDir=path.join(directory,'capture');fs.mkdirSync(captureDir);const captured=captureBundle({store,db,directory:captureDir,canCapture:()=>true});
 assert.equal(captured.state.cycles.length,31);assert.equal(captured.state.cycles[0].id,pending.id);assert.equal(captured.state.cycles.at(-1).id,'synthetic-terminal-34');assert.deepEqual(store.snapshot(),original);assert.equal(fs.readFileSync(store.filePath,'utf8'),bytes);
 const key='b'.repeat(64),sealed=await sealBundle(captured,captureDir,key),destination=path.join(directory,'isolated');const result=await isolatedBackupRestore(sealed.file,destination,key);
 assert.equal(result.recovery_required,true);assert.equal(result.isolated_process,true);assert.equal(result.external_credentials_present,false);
 const restored=new JsonStateStore(path.join(destination,'fancy-truck-state.json'));assert.equal(restored.state.cycles[0].id,pending.id);assert.equal(restored.state.cycles[0].status,'RUNNING');assert.equal(restored.state.actions.synthetic.status,'UNCERTAIN');assert.deepEqual(restored.state.cursors,{synthetic:{lastUid:12}});
 const runtime=applyRecoveryGuard({stateFile:restored.filePath,readOnly:false,automationEnabled:true},restored.state);assert.equal(runtime.automationEnabled,false);assert.throws(()=>assertWritable(runtime));
});

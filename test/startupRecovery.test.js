import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join} from 'node:path';
import {JsonStateStore} from '../src/store.js';

test('startup interruption preserves checkpoints, approvals and uncertain mail operations',t=>{
 const dir=fs.mkdtempSync(join(os.tmpdir(),'cycle-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new JsonStateStore(join(dir,'state.json'));
 store.state.cursors={hello:{lastUid:20}};
 store.state.actions={pending:{status:'PENDING_APPROVAL'}};
 store.state.mail_operations={uncertain:{status:'STARTED'}};
 const old=store.beginCycle(['hello']);store.finishCycle(old.id);
 const interrupted=store.beginCycle(['hello']);
 const snapshot=structuredClone(store.state);
 const restarted=new JsonStateStore(store.filePath);
 assert.equal(restarted.state.cycles.at(-1).status,'RUNNING');
 assert.equal(restarted.reconcileInterruptedCycles(),1);
 assert.equal(restarted.reconcileInterruptedCycles(),0);
 const persisted=new JsonStateStore(store.filePath).state;
 assert.equal(persisted.cycles.at(-1).id,interrupted.id);
 assert.equal(persisted.cycles.at(-1).status,'INTERRUPTED');
 assert(persisted.cycles.at(-1).ended_at);
 assert.deepEqual(persisted.cycles[0],snapshot.cycles[0]);
 for(const key of ['cursors','actions','mail_operations','idempotency'])assert.deepEqual(persisted[key],snapshot[key]);
 assert.equal(persisted.events.filter(e=>e.type==='CYCLES_INTERRUPTED_ON_STARTUP').length,1);
});
test('failed startup reconciliation rolls back memory and fails closed',()=>{
 const store=new JsonStateStore('/nonexistent-synthetic-state.json');
 store.state.cycles=[{id:'interrupted',status:'RUNNING',ended_at:null,errors:[]}];
 const before=structuredClone(store.state);store.save=()=>{throw Error('disk full');};
 assert.throws(()=>store.reconcileInterruptedCycles(),/disk full/);
 assert.deepEqual(store.state,before);
});

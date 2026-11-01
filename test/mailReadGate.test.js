import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createMailReadGate} from '../src/mailReadGate.js';
for(const end of ['finish','close'])test(`${end}: response termination does not release pending work`,()=>{
 const gate=createMailReadGate(),res=new EventEmitter(),done=gate.claim(res);assert(done);res.emit(end);assert.equal(gate.claim(new EventEmitter()),null);done();const next=gate.claim(new EventEmitter());assert(next);done();assert.equal(gate.claim(new EventEmitter()),null);assert.equal(res.listenerCount('finish'),0);assert.equal(res.listenerCount('close'),0);
});
test('work completion holds admission while response remains buffered',()=>{const gate=createMailReadGate(),res=new EventEmitter(),done=gate.claim(res);done();assert.equal(gate.claim(new EventEmitter()),null);res.emit('finish');assert(gate.claim(new EventEmitter()));});
test('already destroyed response can release only after its work completes',()=>{const gate=createMailReadGate(),res=new EventEmitter();res.destroyed=true;const done=gate.claim(res);assert.equal(gate.claim(new EventEmitter()),null);done();assert(gate.claim(new EventEmitter()));});

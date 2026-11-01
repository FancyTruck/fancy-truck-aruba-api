import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { httpFailureDiagnostics } from '../src/httpDiagnostics.js';

test('413 and provider failures log route templates without request secrets', () => {
  for (const statusCode of [413, 500, 502, 503, 504]) {
    const events = [];
    const req = { method: 'GET', route: { path: '/v1/:account/messages/:uid' },
      originalUrl: '/v1/private/messages/123?token=secret', body: { email: 'private@example.test' },
      headers: { authorization: 'Bearer secret' } };
    const res = Object.assign(new EventEmitter(), { statusCode });
    let next = 0, clock = 10;
    httpFailureDiagnostics({ log: e => events.push(e), clock: () => clock, memory: () => 123 })(req, res, () => next++);
    clock = 27;
    res.emit('finish'); res.emit('finish');
    assert.equal(next, 1);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { event: 'http_request_failed', http_status: statusCode, method: 'GET',
      route: '/v1/:account/messages/:uid', duration_ms: 17, rss_bytes: 123 });
    assert(!JSON.stringify(events).includes('secret'));
    assert(!JSON.stringify(events).includes('private'));
  }
});
test('parser failures without a matched route are visible; normal responses stay quiet', () => {
  const events = [];
  const middleware = httpFailureDiagnostics({ log: e => events.push(e) });
  for (const statusCode of [200, 201, 400, 401, 403, 404, 413]) {
    const res = Object.assign(new EventEmitter(), { statusCode });
    middleware({ method: 'POST', originalUrl: '/sensitive' }, res, () => {});
    res.emit('finish');
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].route, 'unmatched');
});
test('logging failure cannot break response completion', () => {
  const res = Object.assign(new EventEmitter(), { statusCode: 502 });
  httpFailureDiagnostics({ log() { throw Error('logger unavailable'); } })({ method: 'GET' }, res, () => {});
  assert.doesNotThrow(() => res.emit('finish'));
});

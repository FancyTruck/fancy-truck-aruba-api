import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeConfig, assertOdooMethod } from '../src/runtime.js';

test('configurazioni conservative e valori non validi bloccati', () => {
  const config = runtimeConfig({});
  assert.equal(config.readOnly, true);
  assert.equal(config.automationEnabled, false);
  assert.equal(config.startupChecks, false);
  assert.notEqual(config.stateFile, runtimeConfig({ APP_ENV: 'test' }).stateFile);
  for (const env of [{ READ_ONLY: 'FALSE' }, { APP_ENV: 'prod' }, { AUTOMATION_ENABLED: 'true' }]) {
    assert.throws(() => runtimeConfig(env));
  }
});

test('Odoo consente solo metodi di lettura noti in READ_ONLY', () => {
  const config = runtimeConfig({});
  for (const method of ['search_read', 'search_count']) assert.doesNotThrow(() => assertOdooMethod(config, method));
  for (const method of ['create', 'write', 'unlink', 'message_post', 'action_confirm', 'autocomplete_by_name']) {
    assert.throws(() => assertOdooMethod(config, method), { code: 'READ_ONLY' });
  }
  assert.doesNotThrow(() => assertOdooMethod(runtimeConfig({ READ_ONLY: 'false' }), 'write'));
});

test('server reale: letture autorizzate, scritture bloccate e stato invariato', { timeout: 12000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fancy-readonly-'));
  const stateFile = path.join(directory, 'state.json');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, APP_ENV: 'test', PORT: '0',
      API_TOKEN: 'local-test-token', REVIEW_READ_TOKEN: 'test-reader', REVIEW_WRITE_TOKEN: 'test-reviewer', STATE_FILE: stateFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errorLog = '';
  child.stderr.on('data', data => { errorLog += String(data); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const base = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Server terminato prima dell’avvio')));
    child.stdout.on('data', (data) => {
      const match = String(data).match(/porta (\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
  });
  const headers = { authorization: 'Bearer local-test-token', 'content-type': 'application/json' };
  const reviewPage = await fetch(`${base}/reviews`);
  assert.equal(reviewPage.status, 200);
  assert.equal(reviewPage.headers.get('cache-control'), 'no-store');
  assert.match(reviewPage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await reviewPage.text(), /Da classificare/);
  assert.equal((await fetch(`${base}/review-assets/reviews.js`)).status, 200);
  assert.equal((await fetch(`${base}/review-assets/reviews.css`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, service: 'fancy-truck-aruba-api' });
  assert.equal((await fetch(`${base}/v1/diagnostics`)).status, 401);
  assert.equal((await fetch(`${base}/v1/accounts`)).status, 401);
  assert.equal((await fetch(`${base}/v1/classification-reviews`)).status, 401);
  assert.deepEqual(await (await fetch(`${base}/v1/classification-reviews`, { headers })).json(), { ok: true, can_resolve: false, items: [] });
  assert.equal((await fetch(`${base}/v1/accounts`, { headers })).status, 200);
  const reader = { authorization: 'Bearer test-reader' };
  assert.equal((await fetch(`${base}/v1/classification-reviews`, { headers: reader })).status, 200);
  assert.equal((await fetch(`${base}/v1/accounts`, { headers: reader })).status, 403);
  assert.equal((await fetch(`${base}/v1/classification-reviews/${'a'.repeat(64)}/resolve`, {
    method: 'POST', headers: { authorization: 'Bearer test-reviewer', 'content-type': 'application/json' },
    body: JSON.stringify({ resolution: 'HANDLED_MANUALLY', note: 'Controllato manualmente' }),
  })).status, 403);

  const diagnostics = await (await fetch(`${base}/v1/diagnostics`, { headers })).json();
  assert.equal(diagnostics.read_only, true);
  assert.equal(diagnostics.automation_status, 'DISABLED');
  assert.deepEqual(diagnostics.automation_reasons, []);
  const oversized = await fetch(`${base}/v1/automation/run?token=never-log-this-private-value`, {
    method: 'POST', headers,
    body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024), secret: 'never-log-this-private-value' }),
  });
  assert.equal(oversized.status, 413);
  await oversized.text();
  if (!errorLog.includes('"event":"http_request_failed"')) await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.stderr.off('data', inspect); reject(Error('missing HTTP diagnostics')); }, 2000);
    function inspect() {
      if (errorLog.includes('"event":"http_request_failed"')) {
        clearTimeout(timeout); child.stderr.off('data', inspect); resolve();
      }
    }
    child.stderr.on('data', inspect);
    inspect();
  });
  assert.match(errorLog, /"event":"http_request_failed","http_status":413/);
  assert(!errorLog.includes('never-log-this-private-value'));
  for (const route of ['/automation/run', '/approvals/test/command', '/approvals/test/confirm',
    '/odoo/contacts', '/odoo/crm/leads', '/odoo/sales/drafts', '/odoo/chatter', '/hello/send', '/actions/test/execute']) {
    const response = await fetch(`${base}/v1${route}`, { method: 'POST', headers, body: '{"force":true}' });
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).code, 'READ_ONLY');
  }
  await assert.rejects(access(stateFile), { code: 'ENOENT' });
});


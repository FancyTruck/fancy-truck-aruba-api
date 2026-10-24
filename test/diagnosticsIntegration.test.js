import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('actual diagnostics route exposes failed persisted cycles without treating process liveness as success',
  { timeout: 10000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'fancy-diagnostics-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const stateFile = join(directory, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ version: 1, cycles: [{ id: 'synthetic-failed-cycle',
      status: 'CONTROLLO NON COMPLETATO', started_at: new Date(Date.now() - 1000).toISOString(),
      ended_at: new Date().toISOString(), failed: 1, suspended: 0, errors: ['synthetic provider unavailable'] }] }));
    const child = spawn(process.execPath, ['src/server.js'], { cwd: new URL('..', import.meta.url),
      env: { PATH: process.env.PATH, APP_ENV: 'test', PORT: '0', STATE_FILE: stateFile,
        API_TOKEN: 'synthetic-diagnostic-token', READ_ONLY: 'false', AUTOMATION_ENABLED: 'true',
        STARTUP_CHECKS: 'false', EXTERNAL_BACKUP_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => {
      if (child.exitCode === null) {
        const stopped = once(child, 'exit'); child.kill(); await stopped;
      }
    });
    child.stderr.resume();
    const base = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(Error('server exited before startup')));
      child.stdout.on('data', data => {
        const match = String(data).match(/porta (\d+)/);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
    });
    const response = await fetch(`${base}/v1/diagnostics`, {
      headers: { authorization: 'Bearer synthetic-diagnostic-token' } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.automation_status, 'DEGRADED');
    assert(result.automation_reasons.includes('LAST_CYCLE_INCOMPLETE'));
    assert.equal(result.last_cycle.id, 'synthetic-failed-cycle');
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

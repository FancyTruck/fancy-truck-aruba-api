import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export const problem = (code, status=400) => Object.assign(new Error(code), {code,status});
export function transaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) {db.exec('ROLLBACK'); throw e;} }
export function openMailDb(file) {
  mkdirSync(dirname(file), {recursive:true,mode:0o700});
  const db=new DatabaseSync(file); chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS mail_cursors(account TEXT NOT NULL, folder TEXT NOT NULL, validity TEXT NOT NULL, last_uid INTEGER NOT NULL, PRIMARY KEY(account,folder));
    CREATE TABLE IF NOT EXISTS mail_messages(account TEXT NOT NULL, folder TEXT NOT NULL, validity TEXT NOT NULL, uid INTEGER NOT NULL, message_id TEXT, thread_key TEXT NOT NULL, payload TEXT NOT NULL, flags TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,folder,validity,uid));
    CREATE INDEX IF NOT EXISTS mail_threads ON mail_messages(account,thread_key);`);
  return db;
}

import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

function ownerError(code, message, cause) {
 return Object.assign(new Error(message, {cause}), {code});
}

function canonicalStateFile(file) {
 const absolute = path.resolve(file);
 let canonical;
 try { canonical = fs.realpathSync(absolute); }
 catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // A dangling symlink cannot define a stable state identity.
  try {
   if (fs.lstatSync(absolute).isSymbolicLink()) {
    throw ownerError('STATE_OWNER_UNSAFE_PATH', 'Dangling state symlink is not supported');
   }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.mkdirSync(path.dirname(absolute), {recursive:true});
  canonical = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
 }
 try {
  const stat = fs.statSync(canonical);
  // Atomic state replacement cannot safely preserve hardlink identities.
  if (!stat.isFile() || stat.nlink !== 1) {
   throw ownerError('STATE_OWNER_UNSAFE_PATH', 'State must be a regular file without hardlinks');
  }
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 return canonical;
}

// This sidecar is only a mutex, never a second business store. Do not copy,
// unlink or replace it while servers can run. SQLite coordinates connections
// on a shared filesystem with working file locks; distributed FS support must
// be established separately. Standalone state writers must obey this protocol.
const owners = new Map();
export function acquireProcessOwner(file) {
 const stateFile = canonicalStateFile(file);
 const ownerFile = stateFile + '.owner.sqlite';
 const busy = cause => ownerError('STATE_OWNER_BUSY', 'State is already owned by a server using this ownership file', cause);
 if (owners.has(stateFile)) throw busy();
 try {
  const stat = fs.lstatSync(ownerFile);
  if (!stat.isFile() || stat.nlink !== 1) {
   throw ownerError('STATE_OWNER_UNSAFE_PATH', 'Ownership file must be regular, without symlinks or hardlinks');
  }
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 let connection;
 try {
  connection = new DatabaseSync(ownerFile, {timeout:0});
  fs.chmodSync(ownerFile, 0o600);
  // No schema or business rows, writes, checkpoints or commits on this DB.
  // EXCLUSIVE fails immediately if another process still owns the file.
  connection.exec('BEGIN EXCLUSIVE');
 } catch (error) {
  connection?.close();
  if ([5,6].includes(error.errcode & 255)) throw busy(error);
  throw ownerError('STATE_OWNER_UNAVAILABLE', 'Cannot establish exclusive state ownership', error);
 }
 // Never close when HTTP closes: handlers may still be running. Keep a strong
 // reference for the entire process lifetime. Normal exit/SIGKILL release the
 // OS locks; no heartbeat, expiry, PID test or stale-lock takeover is needed.
 owners.set(stateFile, connection);
 return Object.freeze({stateFile});
}

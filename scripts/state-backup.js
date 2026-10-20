import { JsonStateStore } from '../src/store.js';
import { backupState, restoreState } from '../src/stateBackup.js';
import fs from 'node:fs';
const [action, source, destination] = process.argv.slice(2);
if (!['backup','restore'].includes(action) || !source || !destination) throw new Error('Uso: node scripts/state-backup.js backup|restore sorgente destinazione-nuova');
fs.accessSync(source);
if (action === 'backup') backupState(new JsonStateStore(source), destination);
else restoreState(source, destination);
console.log('Operazione completata. Il servizio in esecuzione non è stato modificato.');

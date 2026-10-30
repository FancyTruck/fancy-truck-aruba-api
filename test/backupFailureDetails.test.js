import test from 'node:test';
import assert from 'node:assert/strict';
import { backupFailureDetails } from '../src/externalBundleBackup.js';

test('only an explicit provider cap response identifies a download limit', () => {
  const failure = message => Object.assign(new Error(message), { name: 'AccessDenied',
    backupStage: 'download', $metadata: { httpStatusCode: 403 } });
  const result = backupFailureDetails(failure('Cannot download file, download bandwidth or transaction (Class B) cap exceeded'));
  assert.equal(result.reason, 'DOWNLOAD_CAP_EXCEEDED');
  assert.equal(result.stage, 'download');
  assert.equal(result.http_status, 403);
  assert.equal(backupFailureDetails(failure('Access denied for confidential-object')).reason, 'BACKUP_FAILED');
  assert(!JSON.stringify(backupFailureDetails(failure('confidential-object'))).includes('confidential'));
});

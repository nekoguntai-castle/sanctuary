
import { formatBytes } from './common.mjs';

export function createSizedBackupRestoreProofRunner(context) {
  const {
    timestamp,
    apiUrl,
    loginForProof,
    timedPublicApiJson,
  } = context;

  async function runSizedBackupRestoreProof() {
    const token = await loginForProof();
    const backupCreate = await createSizedBackup(token);
    const backup = backupCreate.body;
    const backupMetadata = getSizedBackupMetadata(backup);
  
    const validation = await validateSizedBackup(token, backup);
    assertSizedBackupValidation(validation);
  
    const restore = await restoreSizedBackup(token, backup);
    assertSizedBackupRestore(restore);
  
    return buildSizedBackupRestoreProof(backupCreate, backupMetadata, validation, restore);
  }
  
  async function createSizedBackup(token) {
    return timedPublicApiJson(`${apiUrl}/api/v1/admin/backup`, {
      method: 'POST',
      token,
      body: {
        includeCache: false,
        description: `Phase 3 sized restore proof ${timestamp}`,
      },
    });
  }
  
  function getSizedBackupMetadata(backup) {
    const serializedBackup = JSON.stringify(backup);
    const backupSizeBytes = Buffer.byteLength(serializedBackup, 'utf8');
    const recordCounts = backup?.meta?.recordCounts || {};
    const totalRecords = Object.values(recordCounts).reduce((sum, count) => (
      sum + (Number.isFinite(Number(count)) ? Number(count) : 0)
    ), 0);
  
    return {
      backup,
      backupSizeBytes,
      recordCounts,
      totalRecords,
    };
  }
  
  async function validateSizedBackup(token, backup) {
    return timedPublicApiJson(`${apiUrl}/api/v1/admin/backup/validate`, {
      method: 'POST',
      token,
      body: { backup },
    });
  }
  
  function assertSizedBackupValidation(validation) {
    if (validation.body?.valid !== true) {
      throw new Error(`Sized backup validation failed: ${JSON.stringify(validation.body)}`);
    }
  }
  
  async function restoreSizedBackup(token, backup) {
    return timedPublicApiJson(`${apiUrl}/api/v1/admin/restore`, {
      method: 'POST',
      token,
      body: {
        backup,
        confirmationCode: 'CONFIRM_RESTORE',
      },
    });
  }
  
  function assertSizedBackupRestore(restore) {
    if (restore.body?.success !== true) {
      throw new Error(`Sized backup restore failed: ${JSON.stringify(restore.body)}`);
    }
  }
  
  function buildSizedBackupRestoreProof(backupCreate, backupMetadata, validation, restore) {
    const { backup, backupSizeBytes, recordCounts, totalRecords } = backupMetadata;
    return {
      proofId: timestamp,
      backup: {
        status: backupCreate.status,
        durationMs: backupCreate.durationMs,
        sizeBytes: backupSizeBytes,
        createdAt: backup?.meta?.createdAt || null,
        schemaVersion: backup?.meta?.schemaVersion || null,
        includesCache: backup?.meta?.includesCache ?? null,
        recordCounts,
        totalRecords,
      },
      validation: {
        status: validation.status,
        durationMs: validation.durationMs,
        valid: validation.body?.valid === true,
        issueCount: Array.isArray(validation.body?.issues) ? validation.body.issues.length : null,
        totalRecords: validation.body?.info?.totalRecords ?? null,
      },
      restore: {
        status: restore.status,
        durationMs: restore.durationMs,
        success: restore.body?.success === true,
        tablesRestored: restore.body?.tablesRestored ?? null,
        recordsRestored: restore.body?.recordsRestored ?? null,
        warnings: restore.body?.warnings || [],
      },
    };
  }
  
  function summarizeSizedBackupRestoreProof(proof) {
    const transactionCount = proof.backup.recordCounts?.transaction ?? 'unknown';
    return `${formatBytes(proof.backup.sizeBytes)} backup with ${proof.backup.totalRecords} records (${transactionCount} transactions) restored in ${proof.restore.durationMs}ms`;
  }

  return {
    runSizedBackupRestoreProof,
    summarizeSizedBackupRestoreProof,
  };
}

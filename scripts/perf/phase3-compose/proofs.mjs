
import { createProofApi } from './api.mjs';
import { assertBenchmarkProof } from './benchmark-proof.mjs';
import { createBackendScaleOutProofRunner } from './backend-scale-out-proof.mjs';
import { createCapacitySnapshotRunner } from './capacity-snapshots.mjs';
import { createLargeWalletTransactionHistoryProofRunner } from './large-wallet-history-proof.mjs';
import { createPostgresJsonRunner } from './postgres.mjs';
import { createSizedBackupRestoreProofRunner } from './sized-backup-restore-proof.mjs';
import { createWorkerProofRunners } from './worker-proofs.mjs';

export function createProofRunners(context) {
  const api = createProofApi(context);
  const runPostgresJson = createPostgresJsonRunner(context);
  const capacity = createCapacitySnapshotRunner({
    ...context,
    runPostgresJson,
  });
  const largeWallet = createLargeWalletTransactionHistoryProofRunner({
    ...context,
    ...api,
    runPostgresJson,
  });
  const backup = createSizedBackupRestoreProofRunner({
    ...context,
    ...api,
  });
  const workers = createWorkerProofRunners(context);
  const backend = createBackendScaleOutProofRunner(context);

  return {
    assertBenchmarkProof,
    ...capacity,
    ...largeWallet,
    ...backup,
    ...workers,
    ...backend,
  };
}

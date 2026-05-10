/**
 * Shard definitions for the Critical Mutation Gate.
 *
 * Splits the mutate list into N independent slices so each slice can run on
 * its own runner in parallel. After all slices complete, their JSON reports
 * are merged by `merge-shard-reports.mjs` into the canonical report path that
 * `check-critical-mutation-gate.mjs` consumes.
 *
 * Shard balance was chosen to roughly equalize wallclock by file count and
 * known mutant density (addressDerivation has the largest mutant population
 * by far and gets its own shard).
 */

const SHARDS = {
  1: {
    label: 'addressDerivation',
    mutate: [
      'src/services/bitcoin/addressDerivation.ts',
      'src/services/bitcoin/addressDerivation/**/*.ts',
      '!src/**/*.d.ts',
    ],
  },
  2: {
    label: 'psbt-validation',
    mutate: [
      'src/services/bitcoin/psbtValidation.ts',
      'src/services/bitcoin/psbtInfo.ts',
      'src/services/bitcoin/validationEvidenceContracts.ts',
      '!src/**/*.d.ts',
    ],
  },
  3: {
    label: 'broadcast-auth-access',
    mutate: [
      'src/services/bitcoin/transactions/broadcastContracts.ts',
      'src/services/bitcoin/blockchain/broadcastPreflight.ts',
      'src/api/transactions/broadcastIntent.ts',
      'src/middleware/auth.ts',
      'src/services/accessControl.ts',
      '!src/**/*.d.ts',
    ],
  },
};

const ALL_MUTATE = [
  'src/services/bitcoin/addressDerivation.ts',
  'src/services/bitcoin/addressDerivation/**/*.ts',
  'src/services/bitcoin/psbtValidation.ts',
  'src/services/bitcoin/psbtInfo.ts',
  'src/services/bitcoin/validationEvidenceContracts.ts',
  'src/services/bitcoin/transactions/broadcastContracts.ts',
  'src/services/bitcoin/blockchain/broadcastPreflight.ts',
  'src/api/transactions/broadcastIntent.ts',
  'src/middleware/auth.ts',
  'src/services/accessControl.ts',
  '!src/**/*.d.ts',
];

export const SHARD_IDS = Object.keys(SHARDS).map(Number);

export function resolveShard(shardEnv) {
  if (!shardEnv || shardEnv === 'all') {
    return { id: 'all', label: 'all', mutate: ALL_MUTATE };
  }
  const id = Number(shardEnv);
  const entry = SHARDS[id];
  if (!entry) {
    throw new Error(
      `Unknown MUTATION_SHARD value: ${shardEnv}. Valid values: ${SHARD_IDS.join(', ')} or 'all'.`,
    );
  }
  return { id, ...entry };
}

export function shardReportFileName(shardId) {
  if (shardId === 'all') {
    return 'reports/mutation/critical-mutation-report.json';
  }
  return `reports/mutation/critical-mutation-report.shard-${shardId}.json`;
}

export function shardIncrementalFileName(shardId) {
  if (shardId === 'all') {
    return '.stryker-cache/critical-incremental.json';
  }
  return `.stryker-cache/critical-incremental.shard-${shardId}.json`;
}

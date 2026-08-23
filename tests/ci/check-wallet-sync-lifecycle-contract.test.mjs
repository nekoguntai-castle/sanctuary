import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkWalletSyncLifecycleContract,
  parseWalletSyncLifecycleContract,
} from '../../scripts/check-wallet-sync-lifecycle-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const liveContract = JSON.parse(readFileSync(
  path.join(repoRoot, 'config/wallet-sync-lifecycle-contract.json'),
  'utf8',
));
// Construct negative-fixture imports at runtime so the repository-wide root
// layout scanner does not mistake their intentionally retired paths for live
// source imports.
const retiredBlockchainImport = ['..', '..', 'services', 'bitcoin', 'blockchain'].join('/');
const siblingBlockchainImport = ['..', 'services', 'bitcoin', 'blockchain'].join('/');
const canonicalAdmissionImport = [
  '..',
  '..',
  'services',
  'sync',
  'syncIntentAdmission',
].join('/');

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixtureActivationSymbolReferences() {
  return [
    {
      symbol: 'SYNC_WALLET_MUTATION_FENCE_JOB_VERSION',
      entries: [
        { file: 'server/src/jobs/syncJobContract.ts', role: 'fenced_v3_canonical_wire_contract' },
        { file: 'server/src/services/workerSyncQueue.ts', role: 'dormant_fenced_v3_wakeup_adapter' },
        { file: 'server/src/worker/jobs/syncJobs.ts', role: 'compatible_v3_worker_consumer' },
      ],
    },
    {
      symbol: 'WALLET_SYNC_MUTATION_FENCE_FLOOR',
      entries: [
        { file: 'server/src/constants/walletSyncActivation.ts', role: 'canonical_deployment_floor' },
        { file: 'server/src/jobs/syncJobContract.ts', role: 'fenced_v3_wire_requirement' },
        {
          file: 'server/src/repositories/walletSyncActivationPolicyRepository.ts',
          role: 'immutable_durable_floor',
        },
        {
          file: 'server/src/repositories/walletSyncActivationStabilizationRepository.ts',
          role: 'continuous_ready_evidence_floor',
        },
        { file: 'server/src/services/sync/walletSyncActivationGate.ts', role: 'activation_gate' },
        {
          file: 'server/src/services/workerHeartbeatRegistry.ts',
          role: 'exact_worker_capability_evidence',
        },
        { file: 'server/src/services/workerSyncQueue.ts', role: 'fenced_v3_emission' },
        { file: 'server/src/worker.ts', role: 'worker_runtime_floor' },
        { file: 'server/src/worker/walletSyncRecoveryRuntime.ts', role: 'recovery_runtime_floor' },
      ],
    },
    {
      symbol: 'createProductionWalletSyncRecoveryRuntime',
      entries: [
        { file: 'server/src/worker.ts', role: 'sole_runtime_consumer' },
        { file: 'server/src/worker/walletSyncRecoveryRuntime.ts', role: 'runtime_composition' },
      ],
    },
    {
      symbol: 'createWalletSyncRecoveryRuntime',
      entries: [{
        file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
        role: 'runtime_constructor',
      }],
    },
    {
      symbol: 'walletSyncActivationGate',
      entries: [
        { file: 'server/src/services/sync/syncIntentAdmission.ts', role: 'gate_enforced_admission' },
        { file: 'server/src/services/sync/walletSyncActivationGate.ts', role: 'gate_definition' },
        { file: 'server/src/worker/healthServer.ts', role: 'gate_state_type' },
        { file: 'server/src/worker/walletSyncRecoveryRuntime.ts', role: 'runtime_authority' },
      ],
    },
    {
      symbol: 'walletSyncActivationPolicyRepository',
      entries: [
        {
          file: 'server/src/repositories/walletSyncActivationPolicyRepository.ts',
          role: 'immutable_activation_policy_definition',
        },
        {
          file: 'server/src/services/sync/walletSyncActivationGate.ts',
          role: 'sole_activation_policy_service_consumer',
        },
      ],
    },
    {
      symbol: 'walletSyncActivationStabilizationRepository',
      entries: [
        {
          file: 'server/src/repositories/walletSyncActivationStabilizationRepository.ts',
          role: 'stabilization_definition',
        },
        { file: 'server/src/services/sync/walletSyncActivationGate.ts', role: 'sole_consumer' },
      ],
    },
  ];
}

function compareInventorySymbols(left, right) {
  if (left.symbol === right.symbol) return 0;
  return left.symbol < right.symbol ? -1 : 1;
}

function fixtureContract() {
  const contract = structuredClone(liveContract);
  contract.inventory.directExecutorCalls = [
    {
      callee: 'syncAddress',
      implementationModules: ['server/src/services/bitcoin/blockchain/syncAddress.ts'],
      entries: [],
    },
    {
      callee: 'syncWallet',
      implementationModules: ['server/src/services/bitcoin/blockchain/syncWallet.ts'],
      entries: [
        {
          file: 'server/src/worker/jobs/canonicalIncrementalSync.ts',
          count: 1,
          role: 'generation_bound_worker_executor',
        },
        {
          file: 'server/src/worker/jobs/syncJobs.ts',
          count: 1,
          role: 'legacy_worker_executor_and_canonical_entrypoint',
        },
      ],
    },
  ];
  contract.inventory.symbolReferences = [
    {
      symbol: 'CHECK_STALE_WALLETS_JOB_NAME',
      entries: [{
        file: 'server/src/worker/jobs/syncJobs.ts',
        role: 'legacy_stale_consumer',
      }],
    },
    { symbol: 'SYNC_WALLET_JOB_NAME', entries: [{
      file: 'server/src/worker/jobs/syncJobs.ts',
      role: 'canonical_worker_consumer',
    }] },
    { symbol: 'SYNC_WALLET_JOB_READER_VERSION', entries: [{
      file: 'server/src/jobs/syncJobContract.ts',
      role: 'v2_generation_consumer_contract',
    }, {
      file: 'server/src/services/workerSyncQueue.ts',
      role: 'dormant_v2_wakeup_adapter_and_retained_replay_clock_reset',
    }] },
    { symbol: 'completeSubscriptionEnrollment', entries: [{
      file: 'server/src/repositories/index.ts',
      role: 'neutral_repository_barrel_export',
    }, {
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_checkpoint_completion_writer',
    }, {
      file: 'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
      role: 'dormant_subscription_enrollment_coordinator',
    }] },
    { symbol: 'createSubscriptionCheckpointEnrollment', entries: [{
      file: 'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
      role: 'dormant_subscription_enrollment_coordinator_definition',
    }] },
    { symbol: 'createSyncIntentRecoveryCoordinator', entries: [{
      file: 'server/src/worker/syncIntentRecovery.ts',
      role: 'bounded_recovery_coordinator_definition',
    }, {
      file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
      role: 'sole_production_composition',
    }] },
    { symbol: 'enqueueIncrementalSyncWakeup', entries: [{
      file: 'server/src/services/sync/syncIntentAdmission.ts',
      role: 'canonical_dormant_wakeup_adapter_composition',
    }, {
      file: 'server/src/services/workerSyncQueue.ts',
      role: 'dormant_generation_wakeup_adapter_definition',
    }] },
    { symbol: 'enqueueReservedFullResyncWakeup', entries: [{
      file: 'server/src/services/workerSyncQueue.ts',
      role: 'reserved_generation_wakeup_adapter_definition',
    }, {
      file: 'server/src/worker/syncIntentRecovery.ts',
      role: 'bounded_recovery_port',
    }, {
      file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
      role: 'gate_authorized_composition',
    }] },
    { symbol: 'findStale', entries: [] },
    { symbol: 'requestSubscriptionEnrollment', entries: [{
      file: 'server/src/repositories/index.ts',
      role: 'neutral_repository_barrel_export',
    }, {
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_checkpoint_request_writer',
    }] },
    { symbol: 'syncIntentAdmission', entries: [{
      file: 'server/src/services/sync/syncIntentAdmission.ts',
      role: 'canonical_admission_singleton_definition',
    }, {
      file: 'server/src/worker/jobs/canonicalIncrementalSync.ts',
      role: 'generation_bound_consumer_only',
    }, {
      file: 'server/src/worker/syncIntentRecovery.ts',
      role: 'bounded_recovery_type_contract',
    }, {
      file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
      role: 'gate_authorized_recovery_composition',
    }] },
  ];
  contract.inventory.symbolReferences.push(...fixtureActivationSymbolReferences());
  contract.inventory.symbolReferences.sort(compareInventorySymbols);
  contract.inventory.literalReferences = [
    { literal: 'check-stale-wallets', entries: [] },
    { literal: 'sync-wallet', entries: [] },
    { literal: 'sync:stale:', entries: [] },
  ];
  return contract;
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sanctuary-wallet-lifecycle-'));
  const contract = fixtureContract();
  write(root, 'config/wallet-sync-lifecycle-contract.json', `${JSON.stringify(contract, null, 2)}\n`);
  write(
    root,
    'docs/adr/0004-wallet-sync-lifecycle.md',
    contract.requiredInvariantIds.map((id) => `- \`${id}\``).join('\n'),
  );
  write(
    root,
    'server/ARCHITECTURE.md',
    'See docs/adr/0004-wallet-sync-lifecycle.md and config/wallet-sync-lifecycle-contract.json.\n',
  );
  write(
    root,
    'server/src/jobs/syncJobContract.ts',
    'export const SYNC_JOB_CONTRACT_VERSION = 1 as const;\n'
      + 'export const SYNC_WALLET_JOB_READER_VERSION = 2 as const;\n'
      + 'export const SYNC_WALLET_MUTATION_FENCE_JOB_VERSION = 3 as const;\n'
      + 'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\nvoid requiredMutationFenceFloor;\n',
  );
  write(
    root,
    'server/src/worker/jobs/syncJobs.ts',
    `import { syncWallet } from '${retiredBlockchainImport}';\nvoid CHECK_STALE_WALLETS_JOB_NAME;\nvoid SYNC_WALLET_JOB_NAME;\nvoid SYNC_WALLET_MUTATION_FENCE_JOB_VERSION;\nsyncWallet();\n`,
  );
  write(
    root,
    'server/src/worker/jobs/canonicalIncrementalSync.ts',
    `import { syncWallet } from '${retiredBlockchainImport}';\n`
      + `import { syncIntentAdmission } from '${canonicalAdmissionImport}';\n`
      + 'void syncIntentAdmission;\nsyncWallet();\n',
  );
  write(
    root,
    'server/src/services/workerSyncQueue.ts',
    'void SYNC_WALLET_JOB_READER_VERSION;\n'
      + 'void SYNC_WALLET_MUTATION_FENCE_JOB_VERSION;\n'
      + 'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'export function enqueueIncrementalSyncWakeup() { return true; }\n'
      + 'export function enqueueReservedFullResyncWakeup() { return true; }\n',
  );
  write(
    root,
    'server/src/services/sync/syncIntentAdmission.ts',
    "import { enqueueIncrementalSyncWakeup } from '../workerSyncQueue';\n"
      + "import { walletSyncActivationGate } from './walletSyncActivationGate';\n"
      + 'void enqueueIncrementalSyncWakeup;\n'
      + 'void { inspectActivation: () => walletSyncActivationGate.inspect() };\n'
      + 'export const syncIntentAdmission = {};\n',
  );
  write(
    root,
    'server/src/worker/syncIntentRecovery.ts',
    `import type { syncIntentAdmission } from '${canonicalAdmissionImport}';\n`
      + "import type { enqueueReservedFullResyncWakeup } from '../services/workerSyncQueue';\n"
      + 'export type RecoveryAdmission = typeof syncIntentAdmission;\n'
      + 'export type RecoveryWakeup = typeof enqueueReservedFullResyncWakeup;\n'
      + 'export function createSyncIntentRecoveryCoordinator() {}\n',
  );
  write(
    root,
    'server/src/worker/walletSyncRecoveryRuntime.ts',
    "import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';\n"
      + "import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';\n"
      + "import { walletSyncActivationGate } from '../services/sync/walletSyncActivationGate';\n"
      + "import { enqueueReservedFullResyncWakeup } from '../services/workerSyncQueue';\n"
      + "import { createSyncIntentRecoveryCoordinator } from './syncIntentRecovery';\n"
      + 'export function createWalletSyncRecoveryRuntime() {}\n'
      + 'export function createProductionWalletSyncRecoveryRuntime() {\n'
      + "  const authorize = async () => (await walletSyncActivationGate.inspect()).status === 'active';\n"
      + '  void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + '  void walletSyncActivationGate.activate();\n'
      + '  void syncIntentAdmission.recover({});\n'
      + '  void syncIntentAdmission.recoverExpired({});\n'
      + "  void (async (wakeup) => { if (!await authorize()) return { status: 'blocked' }; return { status: await enqueueReservedFullResyncWakeup(wakeup) ? 'enqueued' : 'unavailable' }; });\n"
      + '  void createSyncIntentRecoveryCoordinator();\n'
      + '  void { activate: () => walletSyncActivationGate.activate() };\n'
      + '  return createWalletSyncRecoveryRuntime();\n}\n',
  );
  write(
    root,
    'server/src/worker.ts',
    "import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from './constants/walletSyncActivation';\n"
      + "import { createProductionWalletSyncRecoveryRuntime } from './worker/walletSyncRecoveryRuntime';\n"
      + 'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'void createProductionWalletSyncRecoveryRuntime();\n',
  );
  write(
    root,
    'server/src/repositories/subscriptionCheckpointRepository.ts',
    'export function completeSubscriptionEnrollment() {}\n'
      + 'export function requestSubscriptionEnrollment() {}\n',
  );
  write(
    root,
    'server/src/repositories/index.ts',
    "export { completeSubscriptionEnrollment, requestSubscriptionEnrollment } from './subscriptionCheckpointRepository';\n",
  );
  write(
    root,
    'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
    "import { completeSubscriptionEnrollment } from '../../repositories/subscriptionCheckpointRepository';\n"
      + 'void completeSubscriptionEnrollment;\n'
      + 'export function createSubscriptionCheckpointEnrollment() {}\n',
  );
  write(
    root,
    'server/src/constants/walletSyncActivation.ts',
    'export const WALLET_SYNC_MUTATION_FENCE_FLOOR = 1 as const;\n',
  );
  write(
    root,
    'server/src/repositories/walletSyncActivationPolicyRepository.ts',
    'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'export const walletSyncActivationPolicyRepository = {};\n',
  );
  write(
    root,
    'server/src/repositories/walletSyncActivationStabilizationRepository.ts',
    'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'export const walletSyncActivationStabilizationRepository = {};\n',
  );
  write(
    root,
    'server/src/services/workerHeartbeatRegistry.ts',
    'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n',
  );
  write(
    root,
    'server/src/services/sync/walletSyncActivationGate.ts',
    'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'void walletSyncActivationPolicyRepository;\n'
      + 'void walletSyncActivationStabilizationRepository;\n'
      + 'export const walletSyncActivationGate = {};\n',
  );
  write(
    root,
    'server/src/worker/healthServer.ts',
    "import type { walletSyncActivationGate } from '../services/sync/walletSyncActivationGate';\n"
      + 'export type Gate = typeof walletSyncActivationGate;\n',
  );
  return root;
}

test('live gated-recovery inventory matches production without claiming cutover', () => {
  const result = checkWalletSyncLifecycleContract(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.contract.deliveryState, 'gated_bounded_recovery');
  assert.equal(result.contract.cutoverComplete, false);
  assert.equal(result.contract.wireContract.currentProducerVersion, 1);
  assert.equal(result.contract.compatibility.staleScheduleState, 'legacy_desired_until_cutover');
  assert.equal(
    result.contract.compatibility.admissionState,
    'gate_enforced_consumer_and_recovery_no_request_producers',
  );
  assert.equal(
    result.contract.compatibility.activationState,
    'continuous_fleet_floor_gate_runtime_enabled',
  );
  assert.equal(
    result.contract.compatibility.recoveryState,
    'gate_enforced_bounded_runtime_enabled',
  );
  assert.equal(
    result.contract.compatibility.subscriptionEnrollmentState,
    'dormant_no_production_consumers',
  );
});

test('accepts an exact gated bounded-recovery inventory fixture', () => {
  assert.deepEqual(checkWalletSyncLifecycleContract(createFixture()).errors, []);
});

test('rejects growth in direct execution and wallet-job reference boundaries', () => {
  const root = createFixture();
  write(
    root,
    'server/src/api/newSync.ts',
    `import * as blockchain from '${siblingBlockchainImport}';\nvoid SYNC_WALLET_JOB_NAME;\nblockchain.syncWallet('wallet-1');\n`,
  );
  const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
  assert.match(errors, /direct syncWallet call inventory changed/);
  assert.match(errors, /symbol SYNC_WALLET_JOB_NAME references changed/);
});

test('rejects an aliased low-level executor import outside the baseline', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/aliasSync.ts',
    "import { syncWallet as execute } from '../bitcoin/blockchain';\nexecute('wallet-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /direct syncWallet call inventory changed/,
  );
});

test('rejects stale compatibility entries after a legacy path is removed', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/jobs/syncJobs.ts',
    'void CHECK_STALE_WALLETS_JOB_NAME;\nvoid SYNC_WALLET_JOB_NAME;\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /direct syncWallet call inventory changed/,
  );
});

test('rejects premature cutover and lifecycle weakening', () => {
  const cutover = fixtureContract();
  cutover.cutoverComplete = true;
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(cutover)),
    /cutoverComplete must remain false/,
  );

  const weakened = fixtureContract();
  weakened.lifecycle.forbiddenWalletHistoryTriggers = ['elapsed_wall_clock'];
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(weakened)),
    /lifecycle\.forbiddenWalletHistoryTriggers/,
  );

  const activatedEnrollment = fixtureContract();
  activatedEnrollment.compatibility.subscriptionEnrollmentState = 'active';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(activatedEnrollment)),
    /subscription enrollment must remain dormant/,
  );

  const movedCoordinator = fixtureContract();
  movedCoordinator.futureOwnership.subscriptionEnrollmentCoordinator = 'server/src/worker.ts';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(movedCoordinator)),
    /must name the dormant coordinator/,
  );
});

test('rejects a production admission producer before the activation release', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/earlyCutover.ts',
    "import { requestIncrementalSync as request } from '../repositories/syncIntentRepository';\n"
      + "void request('wallet-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects request and recovery calls outside their gate-enforced owners', () => {
  const attempts = [
    'void syncIntentAdmission.request(\'wallet-1\');\n',
    'void syncIntentAdmission.recover({ now: new Date() });\n',
    'void syncIntentAdmission.recoverExpired({ now: new Date() });\n',
  ];
  for (const attempt of attempts) {
    const root = createFixture();
    write(
      root,
      'server/src/api/earlyIntent.ts',
      `import { syncIntentAdmission } from '${canonicalAdmissionImport}';\n${attempt}`,
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /durable admission producer activated before cutover/,
    );
  }
});

test('rejects raw request, recovery-read, and reclaim repository access', () => {
  const symbols = [
    'requestIncrementalSync',
    'findActionableIncrementalSyncIntents',
    'findExpiredIncrementalSyncClaims',
    'claimIncrementalSync',
  ];
  for (const symbol of symbols) {
    const root = createFixture();
    write(
      root,
      'server/src/api/rawIntent.ts',
      `import { ${symbol} as bypass } from '../repositories/syncIntentRepository';\nvoid bypass;\n`,
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /durable admission producer activated before cutover/,
    );
  }
});

test('rejects expectedExpiredFence construction outside repository and admission', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/unsafeReclaim.ts',
    'const expectedExpiredFence = { walletId: \'wallet-1\', generation: 1, leaseToken: \'old\' };\n'
      + 'void expectedExpiredFence;\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects direct generation wake-up production outside canonical admission', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/earlyWakeup.ts',
    "import { enqueueIncrementalSyncWakeup as enqueue } from './workerSyncQueue';\n"
      + "void enqueue({ walletId: 'wallet-1', generation: 1, jobId: 'job-1' });\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects reserved full-resync queue wakeups outside the exact recovery runtime', () => {
  const root = createFixture();
  write(
    root,
    'server/src/api/earlyFullResyncWakeup.ts',
    "import { enqueueReservedFullResyncWakeup as wake } from '../services/workerSyncQueue';\n"
      + 'void wake;\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /symbol enqueueReservedFullResyncWakeup references changed/,
  );
});

test('rejects an unguarded reserved wakeup inside the recovery composition root', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/walletSyncRecoveryRuntime.ts',
    "import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';\n"
      + "import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';\n"
      + "import { walletSyncActivationGate } from '../services/sync/walletSyncActivationGate';\n"
      + "import { enqueueReservedFullResyncWakeup } from '../services/workerSyncQueue';\n"
      + "import { createSyncIntentRecoveryCoordinator } from './syncIntentRecovery';\n"
      + 'export function createWalletSyncRecoveryRuntime() {}\n'
      + 'export async function createProductionWalletSyncRecoveryRuntime() {\n'
      + '  void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + "  void (await walletSyncActivationGate.inspect()).status === 'active';\n"
      + '  void syncIntentAdmission.recover({});\n'
      + '  void syncIntentAdmission.recoverExpired({});\n'
      + '  await enqueueReservedFullResyncWakeup({});\n'
      + '  void createSyncIntentRecoveryCoordinator();\n'
      + '  void { activate: () => walletSyncActivationGate.activate() };\n'
      + '  return createWalletSyncRecoveryRuntime();\n}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /reserved full-resync recovery wake-ups must recheck activation inline/,
  );
});

test('rejects an extra unguarded reserved wakeup beside the guarded adapter', () => {
  const additions = [
    'await enqueueReservedFullResyncWakeup({});',
    'const unguardedWake = enqueueReservedFullResyncWakeup;\n  await unguardedWake({});',
    'const firstAlias = enqueueReservedFullResyncWakeup;\n  const secondAlias = firstAlias;\n  await secondAlias({});',
    "const bracketWake = dependencies['enqueueReservedFullResyncWakeup'];\n  await bracketWake({});",
    "await dependencies['enqueueReservedFullResyncWakeup']({});",
    'const { enqueueReservedFullResyncWakeup: destructuredWake } = dependencies;\n  await destructuredWake({});',
  ];
  for (const addition of additions) {
    const root = createFixture();
    const runtimePath = 'server/src/worker/walletSyncRecoveryRuntime.ts';
    const source = readFileSync(path.join(root, runtimePath), 'utf8');
    write(
      root,
      runtimePath,
      source.replace(
        'return createWalletSyncRecoveryRuntime();',
        `${addition}\n  return createWalletSyncRecoveryRuntime();`,
      ),
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /exactly one guarded reserved full-resync enqueue/,
    );
  }
});

test('rejects removal of every required gated recovery composition boundary', () => {
  const runtimePath = 'server/src/worker/walletSyncRecoveryRuntime.ts';
  const cases = [
    [
      'walletSyncActivationGate.inspect()',
      'walletSyncActivationGate.activate()',
      /recovery runtime authorization must inspect the live activation gate/,
    ],
    [
      'syncIntentAdmission.recover({})',
      'undefined',
      /recovery runtime must use gate-enforced incremental recovery/,
    ],
    [
      'syncIntentAdmission.recoverExpired({})',
      'undefined',
      /recovery runtime must use gate-enforced expired recovery/,
    ],
    [
      'activate: () => walletSyncActivationGate.activate()',
      'activate: () => undefined',
      /recovery runtime activation must use the canonical activation gate/,
    ],
    [
      'void createSyncIntentRecoveryCoordinator();',
      'void undefined;',
      /recovery runtime must construct exactly one bounded coordinator/,
    ],
  ];
  for (const [needle, replacement, expected] of cases) {
    const root = createFixture();
    const source = readFileSync(path.join(root, runtimePath), 'utf8');
    assert.ok(source.includes(needle));
    write(root, runtimePath, source.replace(needle, replacement));
    assert.match(checkWalletSyncLifecycleContract(root).errors.join('\n'), expected);
  }

  const root = createFixture();
  const admissionPath = 'server/src/services/sync/syncIntentAdmission.ts';
  const admission = readFileSync(path.join(root, admissionPath), 'utf8');
  write(
    root,
    admissionPath,
    admission.replace(
      'inspectActivation: () => walletSyncActivationGate.inspect()',
      'inspectActivation: () => walletSyncActivationGate.activate()',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /canonical admission must inspect the activation gate/,
  );
});

test('rejects repair-loop activation from the permitted worker consumer', () => {
  const root = createFixture();
  const workerPath = 'server/src/worker/jobs/canonicalIncrementalSync.ts';
  write(
    root,
    workerPath,
    `import { syncWallet } from '${retiredBlockchainImport}';\n`
      + `import { syncIntentAdmission as admission } from '${canonicalAdmissionImport}';\n`
      + 'syncWallet();\nvoid admission.recover;\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects namespace and bracket repair activation from the permitted worker', () => {
  const root = createFixture();
  const workerPath = 'server/src/worker/jobs/canonicalIncrementalSync.ts';
  write(
    root,
    workerPath,
    `import { syncWallet } from '${retiredBlockchainImport}';\n`
      + `import * as intents from '${canonicalAdmissionImport}';\n`
      + "syncWallet();\nvoid intents.syncIntentAdmission?.['recover'];\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects alternate construction of the bounded recovery coordinator', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker.ts',
    "import { createSyncIntentRecoveryCoordinator } from './worker/syncIntentRecovery';\n"
      + 'void createSyncIntentRecoveryCoordinator();\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects alternate recovery-runtime construction outside the worker composition root', () => {
  const root = createFixture();
  write(
    root,
    'server/src/api/alternateRuntime.ts',
    "import { createWalletSyncRecoveryRuntime } from '../worker/walletSyncRecoveryRuntime';\n"
      + 'void createWalletSyncRecoveryRuntime({});\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover|symbol createWalletSyncRecoveryRuntime references changed/,
  );
});

test('rejects activation-gate or policy consumption before the activation release', () => {
  const consumers = [
    "import { walletSyncActivationGate } from './services/sync/walletSyncActivationGate';\nvoid walletSyncActivationGate.activate();\n",
    "import policy from './repositories/walletSyncActivationPolicyRepository';\nvoid policy.activate();\n",
    "import { walletSyncActivationPolicyRepo } from './repositories';\nvoid walletSyncActivationPolicyRepo.activate();\n",
  ];
  for (const source of consumers) {
    const root = createFixture();
    write(root, 'server/src/worker.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /wallet-sync activation floor consumed before activation release/,
    );
  }
});

test('rejects new activation-gate and stabilization repository consumers', () => {
  const consumers = [
    "import { walletSyncActivationGate as gate } from './services/sync/walletSyncActivationGate';\nvoid gate.inspect();\n",
    "import { walletSyncActivationStabilizationRepository as state } from './repositories/walletSyncActivationStabilizationRepository';\nvoid state.observe;\n",
  ];
  for (const source of consumers) {
    const root = createFixture();
    write(root, 'server/src/newConsumer.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /wallet-sync activation floor consumed before activation release/,
    );
  }
});

test('rejects activation capability imported by a validation-only backup consumer', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/backupService/creation.ts',
    "import { activateWalletSync } from '../../repositories/walletSyncActivationPolicyRepository';\n"
      + 'void activateWalletSync();\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-sync activation floor consumed before activation release/,
  );
});

test('rejects a request alias inside the otherwise permitted recovery coordinator', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/syncIntentRecovery.ts',
    `import { syncIntentAdmission } from '${canonicalAdmissionImport}';\n`
      + "import { enqueueReservedFullResyncWakeup } from '../services/workerSyncQueue';\n"
      + 'const producer = syncIntentAdmission;\nconst indirect = producer;\nvoid indirect.request;\n'
      + 'void enqueueReservedFullResyncWakeup;\n'
      + 'export function createSyncIntentRecoveryCoordinator() {}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission producer activated before cutover/,
  );
});

test('rejects a directly aliased subscription checkpoint writer outside the coordinator', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/earlyEnrollment.ts',
    "import { requestSubscriptionEnrollment as request } from '../repositories/subscriptionCheckpointRepository';\n"
      + "void request('address-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /subscription enrollment activated outside its dormant boundary/,
  );
});

test('rejects namespace and bracket checkpoint writer access outside the coordinator', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/earlyEnrollment.ts',
    "import * as checkpoints from '../repositories/subscriptionCheckpointRepository';\n"
      + "void checkpoints['completeSubscriptionEnrollment'];\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /subscription enrollment activated outside its dormant boundary/,
  );
});

test('rejects direct or namespace consumers of the dormant enrollment coordinator', () => {
  const consumers = [
    "import { createSubscriptionCheckpointEnrollment as create } from '../services/sync/subscriptionCheckpointEnrollment';\nvoid create;\n",
    "import * as enrollment from '../services/sync/subscriptionCheckpointEnrollment';\nvoid enrollment.createSubscriptionCheckpointEnrollment;\n",
  ];
  for (const source of consumers) {
    const root = createFixture();
    write(root, 'server/src/worker/earlyEnrollment.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /subscription enrollment activated outside its dormant boundary/,
    );
  }
});

test('requires ADR and architecture links to remain executable documentation', () => {
  const root = createFixture();
  write(root, 'docs/adr/0004-wallet-sync-lifecycle.md', '- `WSYNC-LIFECYCLE-001`\n');
  const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
  assert.match(errors, /must document WSYNC-ADMISSION-001/);
});

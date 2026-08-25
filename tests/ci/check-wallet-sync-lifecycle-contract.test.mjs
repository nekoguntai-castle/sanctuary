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
      symbol: 'WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR',
      entries: [
        {
          file: 'server/src/constants/walletSyncActivation.ts',
          role: 'canonical_scheduler_retirement_floor',
        },
        {
          file: 'server/src/repositories/walletSyncSchedulePolicyRepository.ts',
          role: 'durable_tombstone_compatibility_floor',
        },
        {
          file: 'server/src/services/workerHeartbeatRegistry.ts',
          role: 'exact_scheduler_retirement_capability_evidence',
        },
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
  contract.inventory.addressCreationAuthorities = [];
  contract.inventory.rawQueueMutations = [];
  contract.inventory.producerCallsites = [{
    sink: 'admission.recover',
    file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
    enclosingFunction: 'createProductionWalletSyncRecoveryRuntime',
    count: 1,
    trigger: 'bounded_recovery',
    role: 'gate_rechecked_incremental_recovery',
  }, {
    sink: 'admission.recoverExpired',
    file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
    enclosingFunction: 'createProductionWalletSyncRecoveryRuntime',
    count: 1,
    trigger: 'bounded_recovery',
    role: 'gate_rechecked_expired_recovery',
  }, {
    sink: 'admission.request',
    file: 'server/src/services/sync/manualProducer.ts',
    enclosingFunction: 'requestWalletHistory',
    count: 1,
    trigger: 'explicit_user_request',
    role: 'canonical_manual_api_admission',
  }, {
    sink: 'admission.wake',
    file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
    enclosingFunction: 'createProductionSubscriptionCheckpointRuntime',
    count: 1,
    trigger: 'subscription_checkpoint_comparison',
    role: 'post_commit_exact_generation_wakeup',
  }, {
    sink: 'admission.wakeReservedFullResync',
    file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
    enclosingFunction: 'createProductionWalletSyncRecoveryRuntime',
    count: 1,
    trigger: 'bounded_recovery',
    role: 'gate_rechecked_exact_full_resync_repair_admission',
  }, {
    sink: 'frontend.syncWallet',
    file: 'src/components/ManualSync.ts',
    enclosingFunction: 'handleSync',
    count: 1,
    trigger: 'explicit_user_request',
    role: 'explicit_wallet_sync_action',
  }];
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
    { symbol: 'addressSubscriptionCheckpoint', entries: [{
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_checkpoint_repository',
    }] },
    { symbol: 'completeSubscriptionEnrollment', entries: [{
      file: 'server/src/repositories/index.ts',
      role: 'neutral_repository_barrel_export',
    }, {
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_atomic_checkpoint_intent_writer',
    }, {
      file: 'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
      role: 'bounded_subscription_enrollment_coordinator',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'worker_owned_checkpoint_runtime_composition',
    }] },
    { symbol: 'createProductionSubscriptionCheckpointRuntime', entries: [{
      file: 'server/src/worker.ts',
      role: 'sole_subscription_runtime_consumer',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'production_subscription_runtime_factory',
    }] },
    { symbol: 'createSubscriptionCheckpointEnrollment', entries: [{
      file: 'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
      role: 'bounded_subscription_enrollment_coordinator_definition',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'worker_owned_runtime_coordinator_composition',
    }] },
    { symbol: 'createSubscriptionCheckpointRuntime', entries: [{
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'bounded_subscription_runtime_constructor',
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
      file: 'server/src/services/sync/syncIntentAdmission.ts',
      role: 'canonical_raw_queue_authority',
    }, {
      file: 'server/src/services/workerSyncQueue.ts',
      role: 'reserved_generation_wakeup_adapter_definition',
    }, {
      file: 'server/src/worker/syncIntentRecovery.ts',
      role: 'bounded_recovery_port',
    }, {
      file: 'server/src/worker/walletSyncRecoveryRuntime.ts',
      role: 'gate_authorized_composition',
    }] },
    { symbol: 'findPendingSubscriptionEnrollments', entries: [{
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_bounded_pending_checkpoint_reader',
    }, {
      file: 'server/src/services/sync/subscriptionCheckpointEnrollment.ts',
      role: 'bounded_enrollment_coordinator_reader',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'worker_owned_pending_checkpoint_composition',
    }] },
    { symbol: 'findStale', entries: [] },
    { symbol: 'findSubscriptionCheckpointOwners', entries: [{
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_bounded_checkpoint_owner_reader',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'worker_owned_status_comparison_reader',
    }] },
    { symbol: 'onHeaderObservation', entries: [{
      file: 'server/src/worker.ts',
      role: 'worker_reconciliation_runtime_adapter',
    }, {
      file: 'server/src/worker/electrumManager/networkConnection.ts',
      role: 'single_startup_and_notification_ingress',
    }, {
      file: 'server/src/worker/electrumManager/types.ts',
      role: 'raw_header_observation_callback_contract',
    }] },
    { symbol: 'requestSubscriptionEnrollment', entries: [{
      file: 'server/src/repositories/index.ts',
      role: 'neutral_repository_barrel_export',
    }, {
      file: 'server/src/repositories/subscriptionCheckpointRepository.ts',
      role: 'canonical_checkpoint_request_writer',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'worker_owned_checkpoint_comparison_requester',
    }] },
    { symbol: 'subscribeAddress', entries: [] },
    { symbol: 'subscribeAddressBatch', entries: [] },
    { symbol: 'subscribeHeaders', entries: [{
      file: 'server/src/worker/electrumManager/networkConnection.ts',
      role: 'sole_worker_owned_header_subscription',
    }] },
    { symbol: 'syncIntentAdmission', entries: [{
      file: 'server/src/services/sync/manualProducer.ts',
      role: 'canonical_manual_api_admission',
    }, {
      file: 'server/src/services/sync/syncIntentAdmission.ts',
      role: 'canonical_admission_singleton_definition',
    }, {
      file: 'server/src/worker/jobs/canonicalIncrementalSync.ts',
      role: 'generation_bound_consumer_only',
    }, {
      file: 'server/src/worker/subscriptionCheckpointRuntime.ts',
      role: 'post_commit_checkpoint_intent_wakeup',
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

function writeMultiNetworkFixture(root) {
  write(
    root,
    'server/src/worker.ts',
    "import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from './constants/walletSyncActivation';\n"
      + "import { createProductionWalletSyncRecoveryRuntime } from './worker/walletSyncRecoveryRuntime';\n"
      + "import { createProductionSubscriptionCheckpointRuntime } from './worker/subscriptionCheckpointRuntime';\n"
      + 'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'function recordSubscriptionStatuses() {}\n'
      + 'function startSubscriptionStatusRefreshTimer() { if (subscriptionStatusRefreshInFlight) return; electrumManager.getManagedNetworks(); promise.finally(() => { subscriptionStatusRefreshNetworkIndex += 1; }); }\n'
      + 'function startSubscriptionCheckpointTimer() { if (subscriptionCheckpointInFlight) return; electrumManager.getManagedNetworks(); promise.finally(() => { subscriptionCheckpointNetworkIndex += 1; }); }\n'
      + 'const networkHeaderReconciliationRuntime = { observe() {} };\n'
      + 'new ElectrumSubscriptionManager({ onSubscriptionStatuses: recordSubscriptionStatuses, onHeaderObservation: (network, observation, fetchHeaders) => networkHeaderReconciliationRuntime.observe(network, observation, fetchHeaders) });\n'
      + 'void createProductionSubscriptionCheckpointRuntime;\n'
      + 'void createProductionWalletSyncRecoveryRuntime();\n',
  );
  write(
    root,
    'server/src/worker/electrumManager/electrumManager.ts',
    'class ElectrumSubscriptionManager {\n'
      + '  async startWithLock() {\n'
      + '    const representedNetworkValues = await walletRepository.findRepresentedNetworks();\n'
      + '    representedNetworkValues.map(resolvePersistedBitcoinNetwork);\n'
      + '    await subscribeAllAddresses(a, b, this.callbacks.onSubscriptionStatuses);\n'
      + '  }\n'
      + '  async reconnect() { await subscribeNetworkAddresses(a, b, c, this.callbacks.onSubscriptionStatuses); }\n'
      + '  async reconcileSubscriptions() { return doReconcileSubscriptions(a, b, this.callbacks.onSubscriptionStatuses); }\n'
      + '  async subscribeWalletAddresses() { await this.ensureNetworkConnected(a); await doSubscribeWalletAddresses(a, b, c, d, this.callbacks.onSubscriptionStatuses); }\n'
      + '  async subscribeCheckpointAddresses() { await this.ensureNetworkConnected(a, b, false); }\n'
      + '  async refresh() { await this.callbacks.onSubscriptionStatuses(a, b); }\n'
      + '  async ensureNetworkConnected() {}\n'
      + '  async doConnectNetwork() { const existing = this.networkConnections.get(a); if (existing) { await existing; return; } const connection = connectNetwork(); this.networkConnections.set(a, connection); try { await connection; } finally { if (this.networkConnections.get(a) === connection) this.networkConnections.delete(a); } }\n'
      + '  doScheduleReconnect() { scheduleReconnect(a, b, c, d, e, f, (network) => this.doConnectNetwork(network)); }\n'
      + '}\n',
  );
  write(
    root,
    'server/src/worker/electrumManager/addressSubscriptions.ts',
    'resolvePersistedBitcoinNetwork(first.wallet.network);\n'
      + 'resolvePersistedBitcoinNetwork(second.wallet.network);\n',
  );
  write(
    root,
    'server/src/worker/electrumManager/healthMonitoring.ts',
    'resolvePersistedBitcoinNetwork(wallet.network);\n',
  );
  write(
    root,
    'server/src/worker/electrumManager/networkConnection.ts',
    'const pendingLiveHeaders = new WeakMap();\n'
      + 'async function observeLiveHeader(state, callbacks, block) {\n'
      + '  await callbacks.onHeaderObservation(state.network, block, (startHeight, count) => state.client.getBlockHeaders(startHeight, count));\n'
      + '}\n'
      + 'export async function subscribeHeaders(state, callbacks) {\n'
      + '  const header = await state.client.subscribeHeaders();\n'
      + '  await callbacks.onHeaderObservation(state.network, header, (startHeight, count) => state.client.getBlockHeaders(startHeight, count));\n'
      + '  const block = pendingLiveHeaders.get(state);\n'
      + '  pendingLiveHeaders.set(state, null);\n'
      + '  if (block) {\n'
      + '    await observeLiveHeader(state, callbacks, block);\n'
      + '  }\n'
      + '  const deferred = pendingLiveHeaders.get(state);\n'
      + '  pendingLiveHeaders.delete(state);\n'
      + "  if (deferred) state.client.emit('newBlock', deferred);\n"
      + '}\n'
      + 'export function setupEventHandlers(state, callbacks) {\n'
      + '  pendingLiveHeaders.set(state, null);\n'
      + "  state.client.on('newBlock', (block) => {\n"
      + '    if (pendingLiveHeaders.has(state)) { pendingLiveHeaders.set(state, block); return; }\n'
      + '    void observeLiveHeader(state, callbacks, block);\n'
      + '  });\n'
      + '}\n',
  );
  write(
    root,
    'server/src/worker/electrumManager/types.ts',
    'export interface ElectrumManagerCallbacks { onHeaderObservation: (network: unknown, observation: unknown, fetchHeaders: unknown) => Promise<unknown>; }\n',
  );
  write(
    root,
    'server/src/repositories/walletRepository.ts',
    'prisma.wallet.findMany({ take: REPRESENTED_NETWORK_READ_LIMIT });\n',
  );
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
    "import { enqueueIncrementalSyncWakeup, enqueueReservedFullResyncWakeup } from '../workerSyncQueue';\n"
      + "import { walletSyncActivationGate } from './walletSyncActivationGate';\n"
      + "import { syncLifecyclePublisher } from './syncLifecyclePublisher';\n"
      + 'void enqueueIncrementalSyncWakeup;\nvoid enqueueReservedFullResyncWakeup;\n'
      + 'void { inspectActivation: () => walletSyncActivationGate.inspect() };\n'
      + 'void { publishTransition: syncLifecyclePublisher.publish };\n'
      + 'async function publishIncrementalRequest(walletId, result) {\n'
      + "  await publishTransition({ walletId, transition: 'requested' });\n"
      + '  return result;\n'
      + '}\n'
      + 'async function persistIncrementalRequest(repository, walletId) {\n'
      + '  return publishIncrementalRequest(walletId, await repository.requestIncrementalSync(walletId));\n'
      + '}\n'
      + 'async function persistRetainedStaleRequest(repository, walletId) {\n'
      + '  const result = await repository.requestRetainedStaleIncrementalSync(walletId);\n'
      + '  return publishIncrementalRequest(walletId, result);\n'
      + '}\n'
      + 'async function persistFullRequest(persistFullResyncRequest, walletId) {\n'
      + '  const result = await persistFullResyncRequest(walletId);\n'
      + "  await publishTransition({ walletId, transition: 'requested' });\n"
      + '  return result;\n'
      + '}\n'
      + 'void persistIncrementalRequest;\nvoid persistRetainedStaleRequest;\nvoid persistFullRequest;\n'
      + 'export const syncIntentAdmission = {};\n',
  );
  write(
    root,
    'server/src/worker/syncIntentRecovery.ts',
    `import type { syncIntentAdmission } from '${canonicalAdmissionImport}';\n`
      + 'export type RecoveryAdmission = typeof syncIntentAdmission;\n'
      + 'export interface RecoveryDependencies { enqueueReservedFullResyncWakeup: (wakeup: unknown) => Promise<unknown>; }\n'
      + 'export function createSyncIntentRecoveryCoordinator() {}\n',
  );
  write(
    root,
    'server/src/worker/walletSyncRecoveryRuntime.ts',
    "import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';\n"
      + "import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';\n"
      + "import { walletSyncActivationGate } from '../services/sync/walletSyncActivationGate';\n"
      + "import { createSyncIntentRecoveryCoordinator } from './syncIntentRecovery';\n"
      + 'export function createWalletSyncRecoveryRuntime() {}\n'
      + 'export function createProductionWalletSyncRecoveryRuntime() {\n'
      + "  const authorize = async () => (await walletSyncActivationGate.inspect()).status === 'active';\n"
      + '  void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + '  void walletSyncActivationGate.activate();\n'
      + '  void syncIntentAdmission.recover({});\n'
      + '  void syncIntentAdmission.recoverExpired({});\n'
      + "  void { enqueueReservedFullResyncWakeup: async (wakeup) => { if (!await authorize()) return { status: 'blocked' }; const enqueued = await syncIntentAdmission.wakeReservedFullResync(wakeup); return { status: enqueued ? 'enqueued' : 'unavailable' }; } };\n"
      + '  void createSyncIntentRecoveryCoordinator();\n'
      + '  void { activate: () => walletSyncActivationGate.activate() };\n'
      + '  return createWalletSyncRecoveryRuntime();\n}\n',
  );
  writeMultiNetworkFixture(root);
  write(
    root,
    'server/src/repositories/subscriptionCheckpointRepository.ts',
    'void addressSubscriptionCheckpoint;\n'
      + 'export function completeSubscriptionEnrollment() {}\n'
      + 'export function findPendingSubscriptionEnrollments() {}\n'
      + 'export function findSubscriptionCheckpointOwners() {}\n'
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
      + 'void completeSubscriptionEnrollment;\nvoid findPendingSubscriptionEnrollments;\n'
      + 'export function createSubscriptionCheckpointEnrollment() {}\n',
  );
  write(
    root,
    'server/src/worker/subscriptionCheckpointRuntime.ts',
    "import { completeSubscriptionEnrollment, findPendingSubscriptionEnrollments, findSubscriptionCheckpointOwners, requestSubscriptionEnrollment } from '../repositories/subscriptionCheckpointRepository';\n"
      + "import { createSubscriptionCheckpointEnrollment } from '../services/sync/subscriptionCheckpointEnrollment';\n"
      + "import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';\n"
      + 'void completeSubscriptionEnrollment;\nvoid findPendingSubscriptionEnrollments;\n'
      + 'void findSubscriptionCheckpointOwners;\nvoid requestSubscriptionEnrollment;\n'
      + 'void createSubscriptionCheckpointEnrollment;\n'
      + 'export function createSubscriptionCheckpointRuntime() {}\n'
      + 'export function createProductionSubscriptionCheckpointRuntime() {\n'
      + "  void syncIntentAdmission.wake('wallet-1', 1);\n"
      + '  return createSubscriptionCheckpointRuntime();\n}\n',
  );
  write(
    root,
    'server/src/constants/walletSyncActivation.ts',
    'export const WALLET_SYNC_MUTATION_FENCE_FLOOR = 1 as const;\n'
      + 'export const WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR = 2 as const;\n',
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
    'server/src/repositories/walletSyncSchedulePolicyRepository.ts',
    'void WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR;\n',
  );
  write(
    root,
    'server/src/services/workerHeartbeatRegistry.ts',
    'void WALLET_SYNC_MUTATION_FENCE_FLOOR;\n'
      + 'void WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR;\n',
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
  write(
    root,
    'server/src/services/sync/manualProducer.ts',
    "import { syncIntentAdmission } from './syncIntentAdmission';\n"
      + 'export async function requestWalletHistory(walletId) {\n'
      + '  return syncIntentAdmission.request(walletId);\n}\n',
  );
  write(root, 'src/api/sync.ts', 'export async function syncWallet(walletId) { return walletId; }\n');
  write(
    root,
    'src/components/ManualSync.ts',
    "import * as syncApi from '../api/sync';\n"
      + 'export async function handleSync(walletId) { return syncApi.syncWallet(walletId); }\n',
  );
  return root;
}

test('live canonical producer inventory matches production after scheduler cutover', () => {
  const result = checkWalletSyncLifecycleContract(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.contract.deliveryState, 'canonical_producers_active');
  assert.equal(result.contract.cutoverComplete, true);
  assert.equal(result.contract.wireContract.currentProducerVersion, 3);
  assert.equal(
    result.contract.compatibility.staleScheduleState,
    'durably_forbidden_compatibility_only',
  );
  assert.equal(
    result.contract.compatibility.admissionState,
    'gate_enforced_canonical_request_producers_active',
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
    'worker_owned_bounded_runtime_enabled',
  );
  assert.equal(result.contract.rawHeaderIngress.callback, 'onHeaderObservation');
  assert.equal(
    result.contract.rawHeaderIngress.cacheAdvancePolicy,
    'after_durable_reconciliation_only',
  );
});

test('accepts an exact gated bounded-recovery inventory fixture', () => {
  assert.deepEqual(checkWalletSyncLifecycleContract(createFixture()).errors, []);
});

test('rejects loss of represented-network and strict routing boundaries', () => {
  const missingStartup = createFixture();
  write(
    missingStartup,
    'server/src/worker/electrumManager/electrumManager.ts',
    'void ensureNetworkConnected;\nclass Manager { run() { void this.callbacks.onSubscriptionStatuses; } }\n',
  );
  assert.ok(checkWalletSyncLifecycleContract(missingStartup).errors.some(
    (error) => error.includes('represented networks at startup'),
  ));

  const fallback = createFixture();
  write(
    fallback,
    'server/src/worker/electrumManager/addressSubscriptions.ts',
    "void resolvePersistedBitcoinNetwork;\nvoid (wallet.network || 'mainnet');\n",
  );
  assert.ok(checkWalletSyncLifecycleContract(fallback).errors.some(
    (error) => error.includes('must not fall back an invalid persisted network to mainnet'),
  ));

  const inertWorkerTokens = createFixture();
  const workerPath = path.join(inertWorkerTokens, 'server/src/worker.ts');
  write(
    inertWorkerTokens,
    'server/src/worker.ts',
    readFileSync(workerPath, 'utf8')
      .replace('electrumManager.getManagedNetworks();', 'void electrumManager.getManagedNetworks;')
      .replace(
        'onSubscriptionStatuses: recordSubscriptionStatuses,',
        'onSubscriptionStatuses: inertStatusCallback,',
      ),
  );
  const inertErrors = checkWalletSyncLifecycleContract(inertWorkerTokens).errors;
  assert.ok(inertErrors.some((error) => error.includes('worker checkpoint comparison')));
  assert.ok(inertErrors.some((error) => error.includes('startSubscriptionStatusRefreshTimer')));

  const starvingTimer = createFixture();
  const starvingWorkerPath = path.join(starvingTimer, 'server/src/worker.ts');
  write(
    starvingTimer,
    'server/src/worker.ts',
    readFileSync(starvingWorkerPath, 'utf8').replace(
      'if (subscriptionStatusRefreshInFlight) return; electrumManager.getManagedNetworks(); promise.finally(() => { subscriptionStatusRefreshNetworkIndex += 1; });',
      'electrumManager.getManagedNetworks(); subscriptionStatusRefreshNetworkIndex += 1; if (subscriptionStatusRefreshInFlight) return;',
    ),
  );
  assert.ok(checkWalletSyncLifecycleContract(starvingTimer).errors.some(
    (error) => error.includes('startSubscriptionStatusRefreshTimer'),
  ));

  const inertManagerTokens = createFixture();
  const managerPath = path.join(
    inertManagerTokens,
    'server/src/worker/electrumManager/electrumManager.ts',
  );
  write(
    inertManagerTokens,
    'server/src/worker/electrumManager/electrumManager.ts',
    readFileSync(managerPath, 'utf8').replace(
      'await subscribeAllAddresses(a, b, this.callbacks.onSubscriptionStatuses);',
      'void subscribeAllAddresses; void this.callbacks.onSubscriptionStatuses;',
    ),
  );
  assert.ok(checkWalletSyncLifecycleContract(inertManagerTokens).errors.some(
    (error) => error.includes('through subscribeAllAddresses'),
  ));

  const unsafeManager = createFixture();
  const unsafeManagerPath = path.join(
    unsafeManager,
    'server/src/worker/electrumManager/electrumManager.ts',
  );
  write(
    unsafeManager,
    'server/src/worker/electrumManager/electrumManager.ts',
    readFileSync(unsafeManagerPath, 'utf8')
      .replace('this.ensureNetworkConnected(a, b, false)', 'this.ensureNetworkConnected(a)')
      .replace('this.networkConnections.set(a, connection);', 'void connection;')
      .replace(
        '(network) => this.doConnectNetwork(network)',
        '(network) => connectNetwork(network)',
      ),
  );
  const unsafeManagerErrors = checkWalletSyncLifecycleContract(unsafeManager).errors;
  assert.ok(unsafeManagerErrors.some((error) => error.includes('suppress reentrant readiness')));
  assert.ok(unsafeManagerErrors.some((error) => error.includes('single-flight promise sharing')));
  assert.ok(unsafeManagerErrors.some((error) => error.includes('scheduled reconnects')));

  const inertRepositoryTokens = createFixture();
  write(
    inertRepositoryTokens,
    'server/src/repositories/walletRepository.ts',
    'void prisma.wallet.findMany; void REPRESENTED_NETWORK_READ_LIMIT;\n',
  );
  assert.ok(checkWalletSyncLifecycleContract(inertRepositoryTokens).errors.some(
    (error) => error.includes('bound its represented-network read'),
  ));
});

test('rejects split or legacy raw-header ingress and pre-reconciliation cache advance', () => {
  const legacyCallback = createFixture();
  const legacyPath = path.join(
    legacyCallback,
    'server/src/worker/electrumManager/networkConnection.ts',
  );
  write(
    legacyCallback,
    'server/src/worker/electrumManager/networkConnection.ts',
    readFileSync(legacyPath, 'utf8').replace(
      'callbacks.onHeaderObservation(state.network, block,',
      'callbacks.onNewBlock(state.network, block,',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(legacyCallback).errors.join('\n'),
    /must not retain the legacy onNewBlock callback/,
  );

  const directCacheAdvance = createFixture();
  const cachePath = path.join(
    directCacheAdvance,
    'server/src/worker/electrumManager/networkConnection.ts',
  );
  write(
    directCacheAdvance,
    'server/src/worker/electrumManager/networkConnection.ts',
    readFileSync(cachePath, 'utf8').replace(
      'export function setupEventHandlers(state, callbacks) {',
      'export function setupEventHandlers(state, callbacks) { setCachedBlockHeight(state.lastBlockHeight);',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(directCacheAdvance).errors.join('\n'),
    /must not advance the block-height cache before reconciliation/,
  );

  const missingRangeFetcher = createFixture();
  const fetcherPath = path.join(
    missingRangeFetcher,
    'server/src/worker/electrumManager/networkConnection.ts',
  );
  write(
    missingRangeFetcher,
    'server/src/worker/electrumManager/networkConnection.ts',
    readFileSync(fetcherPath, 'utf8').replace(
      'state.client.getBlockHeaders(startHeight, count)',
      'state.client.getBlockHeader(startHeight)',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(missingRangeFetcher).errors.join('\n'),
    /startup tip and notifications through one onHeaderObservation boundary with a range fetcher/,
  );

  const unbufferedStartup = createFixture();
  const unbufferedPath = path.join(
    unbufferedStartup,
    'server/src/worker/electrumManager/networkConnection.ts',
  );
  write(
    unbufferedStartup,
    'server/src/worker/electrumManager/networkConnection.ts',
    readFileSync(unbufferedPath, 'utf8').replace(
      'if (pendingLiveHeaders.has(state)) { pendingLiveHeaders.set(state, block); return; }',
      'if (pendingLiveHeaders.has(state)) { void observeLiveHeader(state, callbacks, block); return; }',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(unbufferedStartup).errors.join('\n'),
    /must coalesce notifications received during startup and drain them after the startup tip/,
  );

  const fallthroughBuffer = createFixture();
  const fallthroughPath = path.join(
    fallthroughBuffer,
    'server/src/worker/electrumManager/networkConnection.ts',
  );
  write(
    fallthroughBuffer,
    'server/src/worker/electrumManager/networkConnection.ts',
    readFileSync(fallthroughPath, 'utf8').replace(
      'pendingLiveHeaders.set(state, block); return;',
      'pendingLiveHeaders.set(state, block);',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(fallthroughBuffer).errors.join('\n'),
    /must coalesce notifications received during startup and drain them after the startup tip/,
  );

  const detachedWorker = createFixture();
  const workerPath = path.join(detachedWorker, 'server/src/worker.ts');
  write(
    detachedWorker,
    'server/src/worker.ts',
    readFileSync(workerPath, 'utf8').replace(
      'networkHeaderReconciliationRuntime.observe(network, observation, fetchHeaders)',
      'networkHeaderReconciliationRuntime.defer(network, observation, fetchHeaders)',
    ),
  );
  assert.match(
    checkWalletSyncLifecycleContract(detachedWorker).errors.join('\n'),
    /must adapt onHeaderObservation directly to the reconciliation runtime/,
  );
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

test('rejects dynamic, destructured, and intermediary direct executor bypasses', () => {
  const attempts = [
    "const module = await import('../bitcoin/blockchain');\nmodule.syncWallet('wallet-1');\n",
    "const { syncWallet: execute } = await import('../bitcoin/blockchain');\nexecute('wallet-1');\n",
    "import * as blockchain from '../bitcoin/blockchain';\nconst first = blockchain;\nconst second = first;\nsecond['syncWallet']('wallet-1');\n",
  ];
  for (const source of attempts) {
    const root = createFixture();
    write(root, 'server/src/services/executorBypass.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /direct syncWallet call inventory changed/,
    );
  }
});

test('rejects tracked producer re-exports while permitting type-only re-exports', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/executorFacade.ts',
    "export { syncWallet as execute } from './bitcoin/blockchain';\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /tracked wallet-history producer re-export added/,
  );

  write(
    root,
    'server/src/services/executorFacade.ts',
    "export type { SyncWalletOptions } from './bitcoin/blockchain';\n",
  );
  assert.deepEqual(checkWalletSyncLifecycleContract(root).errors, []);
});

test('rejects CommonJS and TypeScript import-equals aliases of tracked modules', () => {
  for (const source of [
    "const { syncIntentAdmission: hiddenAdmission } = require('./sync/syncIntentAdmission');\nvoid hiddenAdmission.request('wallet-1');\n",
    "import hiddenAdmission = require('./sync/syncIntentAdmission');\nvoid hiddenAdmission;\n",
  ]) {
    const root = createFixture();
    write(root, 'server/src/services/commonJsBypass.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /tracked wallet-history modules require static ES imports/,
    );
  }
});

test('rejects a newly named raw wallet-sync queue mutation', () => {
  const root = createFixture();
  const queuePath = 'server/src/services/workerSyncQueue.ts';
  const current = readFileSync(path.join(root, queuePath), 'utf8');
  write(
    root,
    queuePath,
    `${current}\nexport function enqueueWalletSyncBypass() { return getOrCreateSyncQueue().add(SYNC_WALLET_JOB_NAME, { walletId: 'wallet-1' }); }\n`,
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /raw wallet-sync queue mutations changed/,
  );
});

test('rejects a wallet-sync BullMQ mutation outside the canonical queue adapter', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/alternateWalletQueue.ts',
    "import { Queue } from 'bullmq';\n"
      + "const hidden = new Queue('wallet-sync');\n"
      + "export function enqueue() { return hidden.add(['sync', 'wallet'].join('-'), { version: 1, walletId: 'wallet-1' }); }\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /raw wallet-sync queue mutations changed/,
  );
});

test('rejects namespace and aliased BullMQ queue mutations with constant names', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/alternateWalletQueue.ts',
    "import * as BullMQ from 'bullmq';\n"
      + "const queueName = 'wallet-' + 'sync';\n"
      + "const jobName = ['sync', 'wallet'].join('-');\n"
      + 'const { Queue: QueueAlias } = BullMQ;\n'
      + "const resolveJobName = () => ['sync', 'wallet'].join('-');\n"
      + 'const hidden = new QueueAlias(queueName);\n'
      + 'const queueAlias = hidden;\n'
      + 'export function enqueue() {\n'
      + "  return queueAlias.add(resolveJobName() || jobName, { version: 1, walletId: 'wallet-1' });\n"
      + '}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /raw wallet-sync queue mutations changed/,
  );
});

test('rejects an extra admission request inside an inventoried producer function', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/sync/manualProducer.ts',
    "import { syncIntentAdmission } from './syncIntentAdmission';\n"
      + 'export async function requestWalletHistory(walletId) {\n'
      + '  await syncIntentAdmission.request(walletId);\n'
      + '  return syncIntentAdmission.request(walletId);\n}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
  );
});

test('rejects unlisted frontend wallet-history producers and retired user-batch surfaces', () => {
  const attempts = [
    "import { syncWallet } from '../api/sync';\nexport function restoreSession(id) { return syncWallet(id); }\n",
    "export function queueUserWallets() { return fetch('/sync/user', { method: 'POST' }); }\n",
  ];
  for (const source of attempts) {
    const root = createFixture();
    write(root, 'src/auth/sessionRestore.ts', source);
    const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
    assert.match(errors, /wallet-history producer callsites changed|forbidden client wallet-history/);
  }
});

test('rejects non-route callers of manual coordinator producer methods', () => {
  const root = createFixture();
  write(
    root,
    'server/src/auth/sessionRestore.ts',
    "import { getSyncCoordinator } from '../services/sync/syncCoordinator';\n"
      + 'export function restoreSession(userId) {\n'
      + '  return getSyncCoordinator().queueUserWallets(userId);\n}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
  );
});

test('rejects uninventoried initial generation writes and wakeups', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/wallet/alternateCreate.ts',
    "import { INITIAL_SYNC_GENERATION, wakeInitialWalletSync } from '../sync/initialSyncIntent';\n"
      + 'export async function createAlternate(walletId) {\n'
      + '  const data = { requestedIncrementalSyncGeneration: INITIAL_SYNC_GENERATION };\n'
      + '  await wakeInitialWalletSync(walletId);\n'
      + '  return data;\n}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
  );
});

test('rejects generic requested-generation mutation shapes outside the inventory', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/unsafeGenerationWrite.ts',
    "export function mutate(walletRepository) {\n"
      + "  return walletRepository.update('wallet-1', {\n"
      + '    requestedIncrementalSyncGeneration: { increment: 1 },\n'
      + '  });\n'
      + '}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
  );
});

test('rejects a computed requested-generation authority key', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/unsafeComputedGenerationWrite.ts',
    'let generationField;\n'
      + "generationField = 'requestedIncremental' + 'SyncGeneration';\n"
      + 'export function mutate(walletRepository) {\n'
      + "  return walletRepository.update('wallet-1', {\n"
      + '    [generationField]: { increment: 1 },\n'
      + '  });\n'
      + '}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
  );
});

test('rejects reintroduced direct legacy queue producers', () => {
  for (const producer of ['enqueueDeadLetterJob', 'enqueueWalletSync', 'enqueueWalletSyncBatch']) {
    const root = createFixture();
    write(
      root,
      'server/src/api/directQueueProducer.ts',
      `import { ${producer} as enqueue } from '../services/workerSyncQueue';\n`
        + 'export function retry(job) { return enqueue(job); }\n',
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /wallet-history producer callsites changed/,
    );
  }
});

test('rejects a retired bitcoin API wallet-history caller', () => {
  const root = createFixture();
  write(
    root,
    'src/auth/legacyWalletLoad.ts',
    "import { syncWallet as load } from '../api/bitcoin';\n"
      + 'export function loadWallet(walletId) { return load(walletId); }\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /wallet-history producer callsites changed/,
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

test('rejects cutover rollback and lifecycle weakening', () => {
  const cutover = fixtureContract();
  cutover.cutoverComplete = false;
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(cutover)),
    /cutoverComplete must remain true/,
  );

  const weakened = fixtureContract();
  weakened.lifecycle.forbiddenWalletHistoryTriggers = ['elapsed_wall_clock'];
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(weakened)),
    /lifecycle\.forbiddenWalletHistoryTriggers/,
  );

  const splitIngress = fixtureContract();
  splitIngress.rawHeaderIngress.callback = 'onNewBlock';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(splitIngress)),
    /rawHeaderIngress\.callback must be onHeaderObservation/,
  );

  const eagerCache = fixtureContract();
  eagerCache.rawHeaderIngress.cacheAdvancePolicy = 'on_observation';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(eagerCache)),
    /rawHeaderIngress\.cacheAdvancePolicy must be after_durable_reconciliation_only/,
  );

  const dormantEnrollment = fixtureContract();
  dormantEnrollment.compatibility.subscriptionEnrollmentState = 'dormant_no_production_consumers';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(dormantEnrollment)),
    /subscription enrollment must remain bounded and worker-owned/,
  );

  const movedCoordinator = fixtureContract();
  movedCoordinator.futureOwnership.subscriptionEnrollmentCoordinator = 'server/src/worker.ts';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(movedCoordinator)),
    /must name the canonical coordinator/,
  );

  const movedRuntime = fixtureContract();
  movedRuntime.futureOwnership.subscriptionCheckpointRuntime = 'server/src/services/sync/syncService.ts';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(movedRuntime)),
    /must name the worker-owned runtime/,
  );

  const retiredScheduler = fixtureContract();
  retiredScheduler.compatibility.staleScheduleState = 'legacy_desired_until_cutover';
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(retiredScheduler)),
    /must remain durably forbidden after cutover/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
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
      /durable admission consumed outside the exact producer\/consumer inventory/,
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
      /durable admission consumed outside the exact producer\/consumer inventory/,
    );
  }
});

test('rejects direct reset and full-resync generation mutation authorities', () => {
  const attempts = [
    ['resetIncrementalSyncAttempt', '../repositories/syncIntentRepository'],
    ['requestFullResyncGeneration', '../repositories/resyncRepository'],
    ['reserveFullResyncGeneration', '../repositories/resyncRepository'],
  ];
  for (const [symbol, modulePath] of attempts) {
    const root = createFixture();
    write(
      root,
      'server/src/api/rawGenerationMutation.ts',
      `import { ${symbol} as bypass } from '${modulePath}';\nvoid bypass;\n`,
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /durable admission consumed outside the exact producer\/consumer inventory/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
  );
});

test('rejects raw reserved full-resync queue authority outside canonical admission', () => {
  const attempts = [
    "import { enqueueReservedFullResyncWakeup as wake } from '../services/workerSyncQueue';\nvoid wake;\n",
    "import { enqueueReservedFullResyncWakeup as wake } from '../services';\nvoid wake;\n",
    "import * as queue from '../services/workerSyncQueue';\nvoid queue;\n",
    "void import('../services/workerSyncQueue');\n",
  ];
  for (const source of attempts) {
    const root = createFixture();
    write(root, 'server/src/api/earlyFullResyncWakeup.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /raw reserved full-resync queue authority escaped canonical admission/,
    );
  }
});

test('rejects full-resync recovery admission without its inline gate recheck', () => {
  const root = createFixture();
  const runtimePath = 'server/src/worker/walletSyncRecoveryRuntime.ts';
  const source = readFileSync(path.join(root, runtimePath), 'utf8');
  write(root, runtimePath, source.replace(
    "if (!await authorize()) return { status: 'blocked' }; ",
    '',
  ));
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /full-resync recovery must recheck activation then use exact canonical admission/,
  );
});

test('rejects a second full-resync admission inside the recovery adapter', () => {
  const root = createFixture();
  const runtimePath = 'server/src/worker/walletSyncRecoveryRuntime.ts';
  const source = readFileSync(path.join(root, runtimePath), 'utf8');
  write(root, runtimePath, source.replace(
    'return createWalletSyncRecoveryRuntime();',
    "void syncIntentAdmission.wakeReservedFullResync({ walletId: 'wallet-2' });\n  return createWalletSyncRecoveryRuntime();",
  ));
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /exactly one exact full-resync repair admission|wallet-history producer callsites changed/,
  );
});

test('rejects a raw reserved wakeup call hidden in the recovery runtime', () => {
  const root = createFixture();
  const runtimePath = 'server/src/worker/walletSyncRecoveryRuntime.ts';
  const source = readFileSync(path.join(root, runtimePath), 'utf8');
  write(root, runtimePath, source.replace(
    'return createWalletSyncRecoveryRuntime();',
    'void dependencies.enqueueReservedFullResyncWakeup({});\n  return createWalletSyncRecoveryRuntime();',
  ));
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /raw reserved full-resync queue authority escaped canonical admission/,
  );
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
      'syncIntentAdmission.wakeReservedFullResync(wakeup)',
      'undefined',
      /full-resync recovery must recheck activation then use exact canonical admission/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
  );
});

test('rejects admission that stops publishing exact committed request state', () => {
  const root = createFixture();
  const admissionPath = 'server/src/services/sync/syncIntentAdmission.ts';
  const admission = readFileSync(path.join(root, admissionPath), 'utf8');
  write(
    root,
    admissionPath,
    admission.replace('transition: \'requested\'', 'transition: \'cleared\''),
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /incremental and full-resync admission must each publish requested state/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
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
    /durable admission consumed outside the exact producer\/consumer inventory|symbol createWalletSyncRecoveryRuntime references changed/,
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
    /durable admission consumed outside the exact producer\/consumer inventory/,
  );
});

test('rejects a directly aliased subscription checkpoint writer outside the worker runtime', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/earlyEnrollment.ts',
    "import { requestSubscriptionEnrollment as request } from '../repositories/subscriptionCheckpointRepository';\n"
      + "void request('address-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /subscription enrollment consumed outside its worker-owned boundary/,
  );
});

test('rejects a new direct checkpoint-model owner outside the static inventory', () => {
  const root = createFixture();
  write(
    root,
    'server/src/api/unsafeCheckpoint.ts',
    'export async function write(prisma) {\n'
      + '  await prisma.addressSubscriptionCheckpoint.create({ data: {} });\n'
      + '}\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /symbol addressSubscriptionCheckpoint references changed/,
  );
});

test('rejects an address repository writer that bypasses atomic checkpoint creation', () => {
  for (const source of [
    'export async function create(prisma, data) { return prisma.address.create({ data }); }\n',
    "export async function create(prisma, data) { return prisma['address']['create']({ data }); }\n",
    "export async function create(prisma, data) { const model = prisma.address; return model['create']({ data }); }\n",
    "export async function create(prisma, data) { const { address: model } = prisma; return model.create({ data }); }\n",
  ]) {
    const root = createFixture();
    write(root, 'server/src/repositories/addressRepository.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /address creation authority inventory changed/,
    );
  }
});

test('rejects direct Electrum subscription ownership outside the static inventory', () => {
  for (const symbol of ['subscribeAddress', 'subscribeAddressBatch', 'subscribeHeaders']) {
    const root = createFixture();
    write(
      root,
      'server/src/api/unsafeSubscription.ts',
      `export function own(client) { return client.${symbol}(); }\n`,
    );
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      new RegExp(`symbol ${symbol} references changed`),
    );
  }
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
    /subscription enrollment consumed outside its worker-owned boundary/,
  );
});

test('rejects direct or namespace consumers of the enrollment coordinator outside its runtime', () => {
  const consumers = [
    "import { createSubscriptionCheckpointEnrollment as create } from '../services/sync/subscriptionCheckpointEnrollment';\nvoid create;\n",
    "import * as enrollment from '../services/sync/subscriptionCheckpointEnrollment';\nvoid enrollment.createSubscriptionCheckpointEnrollment;\n",
  ];
  for (const source of consumers) {
    const root = createFixture();
    write(root, 'server/src/worker/earlyEnrollment.ts', source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /subscription enrollment consumed outside its worker-owned boundary/,
    );
  }
});

test('rejects API or alternate worker consumers of the subscription checkpoint runtime', () => {
  const consumers = [
    ['server/src/api/earlyEnrollment.ts', "import { createProductionSubscriptionCheckpointRuntime } from '../worker/subscriptionCheckpointRuntime';\nvoid createProductionSubscriptionCheckpointRuntime;\n"],
    ['server/src/worker/alternateEnrollment.ts', "import * as runtime from './subscriptionCheckpointRuntime';\nvoid runtime.createSubscriptionCheckpointRuntime;\n"],
  ];
  for (const [file, source] of consumers) {
    const root = createFixture();
    write(root, file, source);
    assert.match(
      checkWalletSyncLifecycleContract(root).errors.join('\n'),
      /subscription enrollment consumed outside its worker-owned boundary/,
    );
  }
});

test('requires ADR and architecture links to remain executable documentation', () => {
  const root = createFixture();
  write(root, 'docs/adr/0004-wallet-sync-lifecycle.md', '- `WSYNC-LIFECYCLE-001`\n');
  const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
  assert.match(errors, /must document WSYNC-ADMISSION-001/);
});

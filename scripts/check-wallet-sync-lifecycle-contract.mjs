#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const CONTRACT_PATH = 'config/wallet-sync-lifecycle-contract.json';
const ADR_PATH = 'docs/adr/0004-wallet-sync-lifecycle.md';
const ARCHITECTURE_PATH = 'server/ARCHITECTURE.md';
const REQUIRED_INVARIANTS = [
  'WSYNC-ADMISSION-001',
  'WSYNC-BLOCK-001',
  'WSYNC-COMPAT-001',
  'WSYNC-LIFECYCLE-001',
  'WSYNC-STALE-001',
  'WSYNC-WORKER-001',
];
const REQUIRED_STATES = [
  'initial_catch_up',
  'subscribed_current',
  'activity_driven_incremental_catch_up',
];
const REQUIRED_TRIGGERS = [
  'address_activity',
  'explicit_user_request',
  'first_never_synced',
  'reconnect_gap',
  'startup_gap',
];
const REQUIRED_FORBIDDEN_TRIGGERS = [
  'block_header',
  'elapsed_wall_clock',
  'ordinary_navigation',
  'session_restore',
];
const REQUIRED_SUBSCRIPTION_NETWORKS = [
  'mainnet',
  'testnet3',
  'testnet4',
  'signet',
  'regtest',
];
const SYNC_INTENT_REPOSITORY_BOUNDARY_SYMBOLS = [
  'claimIncrementalSync',
  'completeIncrementalSync',
  'findActionableIncrementalSyncIntents',
  'findExpiredIncrementalSyncClaims',
  'findIncrementalSyncIntent',
  'releaseIncrementalSyncAsActionRequired',
  'releaseIncrementalSyncForRetry',
  'requestIncrementalSync',
];
const ADMISSION_SINGLETON_METHODS = [
  'bridgeRetained',
  'claimFresh',
  'complete',
  'recover',
  'recoverExpired',
  'reclaimExpired',
  'releaseAsActionRequired',
  'releaseForRetry',
  'request',
  'requestFullResync',
  'reset',
  'wake',
  'wakeReservedFullResync',
];
const SYNC_INTENT_REPOSITORY_PATH = 'server/src/repositories/syncIntentRepository.ts';
const RESYNC_REPOSITORY_PATH = 'server/src/repositories/resyncRepository.ts';
const INCREMENTAL_WAKEUP_ADAPTER_PATH = 'server/src/services/workerSyncQueue.ts';
const RECOVERY_COORDINATOR_PATH = 'server/src/worker/syncIntentRecovery.ts';
const RECOVERY_COORDINATOR_SYMBOL = 'createSyncIntentRecoveryCoordinator';
const RECOVERY_RUNTIME_PATH = 'server/src/worker/walletSyncRecoveryRuntime.ts';
const WORKER_PATH = 'server/src/worker.ts';
const ACTIVATION_GATE_PATH =
  'server/src/services/sync/walletSyncActivationGate.ts';
const ACTIVATION_POLICY_REPOSITORY_PATH =
  'server/src/repositories/walletSyncActivationPolicyRepository.ts';
const ACTIVATION_STABILIZATION_REPOSITORY_PATH =
  'server/src/repositories/walletSyncActivationStabilizationRepository.ts';
const REPOSITORY_BARREL_PATH = 'server/src/repositories/index.ts';
const SUBSCRIPTION_ENROLLMENT_COORDINATOR_SYMBOL = 'createSubscriptionCheckpointEnrollment';
const SUBSCRIPTION_CHECKPOINT_RUNTIME_PATH =
  'server/src/worker/subscriptionCheckpointRuntime.ts';
const RAW_HEADER_INGRESS_PATH =
  'server/src/worker/electrumManager/networkConnection.ts';
const RAW_HEADER_CALLBACK_TYPES_PATH =
  'server/src/worker/electrumManager/types.ts';
const RAW_HEADER_RECONCILIATION_RUNTIME_PATH =
  'server/src/worker/networkHeaderReconciliationRuntime.ts';
const SUBSCRIPTION_CHECKPOINT_RUNTIME_FACTORY_SYMBOL =
  'createSubscriptionCheckpointRuntime';
const PRODUCTION_SUBSCRIPTION_CHECKPOINT_RUNTIME_FACTORY_SYMBOL =
  'createProductionSubscriptionCheckpointRuntime';
const SUBSCRIPTION_ENROLLMENT_WRITERS = [
  'completeSubscriptionEnrollment',
  'requestSubscriptionEnrollment',
];
const PRODUCTION_SOURCE_ROOTS = ['gateway/src', 'server/src', 'src'];
const TRACKED_PRODUCER_SINKS = new Set([
  'authority.requestedIncrementalSyncGenerationWrite',
  'admission.bridgeRetained', 'admission.claimFresh', 'admission.complete', 'admission.recover',
  'admission.recoverExpired', 'admission.reclaimExpired',
  'admission.releaseAsActionRequired', 'admission.releaseForRetry',
  'admission.request', 'admission.requestFullResync', 'admission.reset',
  'admission.wake', 'admission.wakeReservedFullResync',
  'coordinator.queueNetworkSync', 'coordinator.queueUserWallets',
  'coordinator.queueWalletSync', 'coordinator.resyncNetwork', 'coordinator.resyncWallet',
  'coordinator.syncLegacyBitcoinAddress', 'coordinator.syncLegacyBitcoinWallet',
  'coordinator.syncWalletNow',
  'frontend.queueSync', 'frontend.queueUserWallets', 'frontend.syncAddress',
  'frontend.resyncNetworkWallets', 'frontend.resyncWallet',
  'frontend.syncNetworkWallets', 'frontend.syncWallet',
  'initial.generationOneWrite', 'initial.wakeInitialWalletSync',
  'legacy.enqueueDeadLetterJob', 'legacy.enqueueFullResyncBatch',
  'legacy.enqueueWalletSync', 'legacy.enqueueWalletSyncBatch',
]);
const TRACKED_EXECUTOR_SINKS = new Set(['executor.syncAddress', 'executor.syncWallet']);
const IMPORTED_IDENTITIES = new Map([
  ['admission\0syncIntentAdmission', 'admission'],
  ['coordinator\0getSyncCoordinator', 'coordinator.factory'],
  ['coordinator\0SyncCoordinator', 'coordinator.class'],
  ...[
    'queueNetworkSync', 'queueUserWallets', 'queueWalletSync', 'resyncNetwork', 'resyncWallet',
    'syncLegacyBitcoinAddress', 'syncLegacyBitcoinWallet', 'syncWalletNow',
  ].map(name => [`coordinator\0${name}`, `coordinator.${name}`]),
  ...[
    'queueSync', 'queueUserWallets', 'resyncNetworkWallets', 'resyncWallet', 'syncAddress',
    'syncNetworkWallets', 'syncWallet',
  ].map(name => [`frontend\0${name}`, `frontend.${name}`]),
  ...['syncAddress', 'syncWallet'].map(name => [`executor\0${name}`, `executor.${name}`]),
  ...[
    'enqueueDeadLetterJob', 'enqueueFullResyncBatch',
    'enqueueWalletSync', 'enqueueWalletSyncBatch',
  ].map(name => [`legacy\0${name}`, `legacy.${name}`]),
  ['initial\0wakeInitialWalletSync', 'initial.wakeInitialWalletSync'],
  ['initial\0INITIAL_SYNC_GENERATION', 'initial.generationConstant'],
]);

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkCode(root, relativePath = 'server/src', files = []) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return files;
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    if (/\.(?:ts|js|mjs|cjs)$/.test(relativePath)) files.push(normalize(relativePath));
    return files;
  }
  if (!stats.isDirectory()) return files;
  for (const entry of readdirSync(absolutePath)) {
    walkCode(root, path.join(relativePath, entry), files);
  }
  return files;
}

function collectProductionSources(root) {
  return new Map(PRODUCTION_SOURCE_ROOTS.flatMap(sourceRoot => walkCode(root, sourceRoot))
    .filter(file => !file.startsWith('server/src/generated/'))
    .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
}

function readRequired(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing required file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function requireObject(value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function requireString(value, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function requireArray(value, context) {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function assertExact(actual, expected, context) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${context} must equal ${JSON.stringify(expected)}`);
  }
}

function assertSortedUnique(values, context) {
  const sorted = [...new Set(values)].sort();
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${context} must be sorted and contain no duplicates`);
  }
}

function validateEntries(entries, context, withCount = false) {
  const files = requireArray(entries, context).map((entry, index) => {
    const parsed = requireObject(entry, `${context}[${index}]`);
    const file = requireString(parsed.file, `${context}[${index}].file`);
    requireString(parsed.role, `${context}[${index}].role`);
    if (withCount && (!Number.isSafeInteger(parsed.count) || parsed.count < 1)) {
      throw new Error(`${context}[${index}].count must be a positive safe integer`);
    }
    return file;
  });
  assertSortedUnique(files, `${context} files`);
  return entries;
}

function validateInventory(inventory) {
  const parsed = requireObject(inventory, 'inventory');
  const directCalls = requireArray(parsed.directExecutorCalls, 'inventory.directExecutorCalls');
  const callees = directCalls.map((definition, index) => {
    const item = requireObject(definition, `inventory.directExecutorCalls[${index}]`);
    const callee = requireString(item.callee, `inventory.directExecutorCalls[${index}].callee`);
    const implementations = requireArray(
      item.implementationModules,
      `inventory.directExecutorCalls[${index}].implementationModules`,
    ).map((file, fileIndex) => requireString(
      file,
      `inventory.directExecutorCalls[${index}].implementationModules[${fileIndex}]`,
    ));
    assertSortedUnique(implementations, `implementation modules for ${callee}`);
    validateEntries(item.entries, `direct executor entries for ${callee}`, true);
    return callee;
  });
  assertSortedUnique(callees, 'inventory direct executor callees');

  for (const [key, identity] of [
    ['symbolReferences', 'symbol'],
    ['literalReferences', 'literal'],
  ]) {
    const definitions = requireArray(parsed[key], `inventory.${key}`);
    const identities = definitions.map((definition, index) => {
      const item = requireObject(definition, `inventory.${key}[${index}]`);
      const value = requireString(item[identity], `inventory.${key}[${index}].${identity}`);
      validateEntries(item.entries, `${key} entries for ${value}`);
      return value;
    });
    assertSortedUnique(identities, `inventory.${key} identities`);
  }
  const callsites = requireArray(parsed.producerCallsites, 'inventory.producerCallsites')
    .map((entry, index) => {
      const item = requireObject(entry, `inventory.producerCallsites[${index}]`);
      for (const field of ['sink', 'file', 'enclosingFunction', 'trigger', 'role']) {
        requireString(item[field], `inventory.producerCallsites[${index}].${field}`);
      }
      if (!Number.isSafeInteger(item.count) || item.count < 1) {
        throw new Error(`inventory.producerCallsites[${index}].count must be a positive safe integer`);
      }
      return producerCallsiteIdentity(item);
    });
  assertSortedUnique(callsites, 'inventory.producerCallsites identities');
  const rawQueueMutations = requireArray(
    parsed.rawQueueMutations,
    'inventory.rawQueueMutations',
  ).map((entry, index) => {
    const item = requireObject(entry, `inventory.rawQueueMutations[${index}]`);
    for (const field of ['file', 'enclosingFunction', 'method', 'role']) {
      requireString(item[field], `inventory.rawQueueMutations[${index}].${field}`);
    }
    if (!['add', 'addBulk'].includes(item.method)) {
      throw new Error(`inventory.rawQueueMutations[${index}].method must be add or addBulk`);
    }
    if (!Number.isSafeInteger(item.count) || item.count < 1) {
      throw new Error(`inventory.rawQueueMutations[${index}].count must be a positive safe integer`);
    }
    return rawQueueMutationIdentity(item);
  });
  assertSortedUnique(rawQueueMutations, 'inventory.rawQueueMutations identities');
  const addressAuthorities = requireArray(
    parsed.addressCreationAuthorities,
    'inventory.addressCreationAuthorities',
  ).map((entry, index) => {
    const item = requireObject(entry, `inventory.addressCreationAuthorities[${index}]`);
    for (const field of ['file', 'enclosingFunction', 'method', 'role']) {
      requireString(item[field], `inventory.addressCreationAuthorities[${index}].${field}`);
    }
    if (!['create', 'createMany', 'createManyAndReturn'].includes(item.method)) {
      throw new Error(`inventory.addressCreationAuthorities[${index}].method is invalid`);
    }
    if (!Number.isSafeInteger(item.count) || item.count < 1) {
      throw new Error(`inventory.addressCreationAuthorities[${index}].count must be positive`);
    }
    return `${item.file}\0${item.enclosingFunction}\0${item.method}`;
  });
  assertSortedUnique(addressAuthorities, 'inventory.addressCreationAuthorities identities');
  const forbidden = requireObject(
    parsed.forbiddenClientWalletHistory,
    'inventory.forbiddenClientWalletHistory',
  );
  for (const field of ['symbols', 'paths']) {
    const values = requireArray(forbidden[field], `inventory.forbiddenClientWalletHistory.${field}`)
      .map((value, index) => requireString(
        value,
        `inventory.forbiddenClientWalletHistory.${field}[${index}]`,
      ));
    assertSortedUnique(values, `inventory.forbiddenClientWalletHistory.${field}`);
  }
  return parsed;
}

export function parseWalletSyncLifecycleContract(source) {
  const contract = requireObject(JSON.parse(source), 'contract');
  if (contract.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (contract.deliveryState !== 'canonical_producers_active') {
    throw new Error('deliveryState must be canonical_producers_active in this slice');
  }
  if (contract.cutoverComplete !== false) throw new Error('cutoverComplete must remain false');

  const wire = requireObject(contract.wireContract, 'wireContract');
  if (wire.currentProducerVersion !== 3 || wire.unversionedPayloadMeans !== 1) {
    throw new Error('canonical producers must emit v3 while retaining unversioned-v1 reads');
  }
  if (wire.canonicalWakeupVersion !== 3
    || wire.preMutationFenceMaximumReadableVersion !== 2) {
    throw new Error('canonical wake-ups must use v3 above the pre-fence v2 reader ceiling');
  }
  assertExact(wire.requiredReadableVersions, [1, 2, 3], 'wireContract.requiredReadableVersions');

  const lifecycle = requireObject(contract.lifecycle, 'lifecycle');
  assertExact(lifecycle.states, REQUIRED_STATES, 'lifecycle.states');
  assertExact(lifecycle.walletHistoryTriggers, REQUIRED_TRIGGERS, 'lifecycle.walletHistoryTriggers');
  assertExact(
    lifecycle.forbiddenWalletHistoryTriggers,
    REQUIRED_FORBIDDEN_TRIGGERS,
    'lifecycle.forbiddenWalletHistoryTriggers',
  );
  if (lifecycle.blockHeaderRole !== 'chain_tip_and_known_transaction_confirmations_only') {
    throw new Error('block headers must remain confirmation/tip events only');
  }
  validateRawHeaderIngress(contract.rawHeaderIngress);
  const multiNetwork = requireObject(
    contract.multiNetworkSubscription,
    'multiNetworkSubscription',
  );
  assertExact(
    multiNetwork.supportedNetworks,
    REQUIRED_SUBSCRIPTION_NETWORKS,
    'multiNetworkSubscription.supportedNetworks',
  );
  const expectedMultiNetworkFields = {
    representedNetworkReader: 'walletRepository.findRepresentedNetworks',
    strictPersistedNetworkResolver: 'resolvePersistedBitcoinNetwork',
    authoritativeStatusCallback: 'onSubscriptionStatuses',
    startupPolicy: 'configured_plus_represented',
    dynamicPolicy: 'connect_supported_network_on_demand',
    invalidPersistedNetworkPolicy: 'fail_closed_without_mainnet_fallback',
  };
  for (const [field, expected] of Object.entries(expectedMultiNetworkFields)) {
    if (multiNetwork[field] !== expected) {
      throw new Error(`multiNetworkSubscription.${field} must be ${expected}`);
    }
  }

  const ownership = validateOwnership(contract.futureOwnership);
  validateCompatibility(contract.compatibility);
  assertExact(contract.requiredInvariantIds, REQUIRED_INVARIANTS, 'requiredInvariantIds');
  const inventory = validateInventory(contract.inventory);
  validateSubscriptionInventory(inventory, ownership);
  return contract;
}

function validateRawHeaderIngress(value) {
  const ingress = requireObject(value, 'rawHeaderIngress');
  const expectedFields = {
    callback: 'onHeaderObservation',
    ingressModule: RAW_HEADER_INGRESS_PATH,
    reconciliationRuntime: RAW_HEADER_RECONCILIATION_RUNTIME_PATH,
    startupTipPolicy: 'same_durable_boundary_as_notifications',
    cacheAdvancePolicy: 'after_durable_reconciliation_only',
    legacyCallback: 'onNewBlock',
    legacyDirectCacheAdvance: 'forbidden',
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (ingress[field] !== expected) {
      throw new Error(`rawHeaderIngress.${field} must be ${expected}`);
    }
  }
  return ingress;
}

function validateOwnership(value) {
  const ownership = requireObject(value, 'futureOwnership');
  if (ownership.singleAdmissionModule !== 'server/src/services/sync/syncIntentAdmission.ts') {
    throw new Error('futureOwnership.singleAdmissionModule must name the canonical intent service');
  }
  if (ownership.subscriptionCheckpointRepository
    !== 'server/src/repositories/subscriptionCheckpointRepository.ts') {
    throw new Error('futureOwnership.subscriptionCheckpointRepository must name the canonical repository');
  }
  if (ownership.subscriptionEnrollmentCoordinator
    !== 'server/src/services/sync/subscriptionCheckpointEnrollment.ts') {
    throw new Error('futureOwnership.subscriptionEnrollmentCoordinator must name the canonical coordinator');
  }
  if (ownership.subscriptionCheckpointRuntime !== SUBSCRIPTION_CHECKPOINT_RUNTIME_PATH) {
    throw new Error('futureOwnership.subscriptionCheckpointRuntime must name the worker-owned runtime');
  }
  if (ownership.walletHistoryExecutor !== 'server/src/worker/jobs/syncJobs.ts') {
    throw new Error('futureOwnership.walletHistoryExecutor must remain worker-owned');
  }
  if (ownership.subscriptionOwner !== 'worker') {
    throw new Error('futureOwnership.subscriptionOwner must be worker');
  }
  if (ownership.queueRole !== 'at_least_once_wakeup_only') {
    throw new Error('futureOwnership.queueRole must remain an at-least-once wake-up only');
  }
  return ownership;
}

function validateCompatibility(value) {
  const compatibility = requireObject(value, 'compatibility');
  if (compatibility.admissionState !== 'gate_enforced_canonical_request_producers_active') {
    throw new Error('canonical request producers must remain gate-enforced');
  }
  if (compatibility.activationState !== 'continuous_fleet_floor_gate_runtime_enabled'
    || compatibility.mutationFenceFloor !== 1) {
    throw new Error('the continuous mutation-fence fleet floor gate must remain enabled');
  }
  if (compatibility.preFenceWorkerBehavior !== 'reject_v3_before_lock') {
    throw new Error('pre-fence workers must reject canonical v3 before locking');
  }
  if (compatibility.generationConsumerModule
    !== 'server/src/worker/jobs/canonicalIncrementalSync.ts') {
    throw new Error('compatibility.generationConsumerModule must name the bounded worker engine');
  }
  if (compatibility.recoveryState !== 'gate_enforced_bounded_runtime_enabled') {
    throw new Error('intent recovery must remain bounded and activation-gate enforced');
  }
  if (compatibility.recoveryCoordinatorModule !== RECOVERY_COORDINATOR_PATH) {
    throw new Error('compatibility.recoveryCoordinatorModule must name the bounded coordinator');
  }
  if (compatibility.subscriptionEnrollmentState !== 'worker_owned_bounded_runtime_enabled') {
    throw new Error('subscription enrollment must remain bounded and worker-owned after activation');
  }
  if (compatibility.staleScheduleName !== 'check-stale-wallets') {
    throw new Error('compatibility.staleScheduleName must retain the legacy wire identity');
  }
  if (compatibility.staleScheduleState !== 'legacy_desired_until_cutover') {
    throw new Error('the precursor must not claim stale-schedule cutover');
  }
  if (compatibility.durableDisablePolicyState !== 'immutable_activation_floor_live_fleet_enforced') {
    throw new Error('the immutable activation floor must remain live-fleet enforced');
  }
  if (compatibility.legacyEntriesAreTemporary !== true) {
    throw new Error('compatibility legacy entries must be explicitly temporary');
  }
}

function collectSources(root) {
  return new Map(walkCode(root).map((file) => [
    file,
    stripComments(readFileSync(path.join(root, file), 'utf8')),
  ]));
}

function producerCallsiteIdentity({ sink, file, enclosingFunction }) {
  return `${sink}\0${file}\0${enclosingFunction}`;
}

function rawQueueMutationIdentity({ file, enclosingFunction, method }) {
  return `${file}\0${enclosingFunction}\0${method}`;
}

function moduleKind(specifier) {
  if (/syncIntentAdmission(?:\.[cm]?[jt]s)?$/.test(specifier)) return 'admission';
  if (/syncCoordinator(?:\.[cm]?[jt]s)?$/.test(specifier)) return 'coordinator';
  if (/\/api\/(?:bitcoin|sync)(?:\.[cm]?[jt]s)?$/.test(specifier)) return 'frontend';
  if (/\/bitcoin\/blockchain(?:\/[^/]+)?$/.test(specifier)) return 'executor';
  if (/workerSyncQueue(?:\.[cm]?[jt]s)?$/.test(specifier)) return 'legacy';
  if (/initialSyncIntent(?:\.[cm]?[jt]s)?$/.test(specifier)) return 'initial';
  return null;
}

function importedIdentity(kind, imported) {
  return IMPORTED_IDENTITIES.get(`${kind}\0${imported}`) ?? null;
}

function propertyText(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;
}

function unwrapExpression(expression) {
  let current = expression;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current) || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

function dynamicImportKind(expression) {
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current) || current.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  return ts.isStringLiteralLike(current.arguments[0]) ? moduleKind(current.arguments[0].text) : null;
}

function resolveConstructedExpression(current, bindings) {
  if (ts.isCallExpression(current)) {
    return resolveExpression(current.expression, bindings) === 'coordinator.factory'
      ? 'coordinator'
      : null;
  }
  if (!ts.isNewExpression(current)) return null;
  return resolveExpression(current.expression, bindings) === 'coordinator.class'
    ? 'coordinator'
    : null;
}

function resolvePropertyExpression(current, bindings) {
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) return null;
  const base = resolveExpression(current.expression, bindings);
  const property = propertyText(ts.isPropertyAccessExpression(current)
    ? current.name
    : current.argumentExpression);
  if (!base || !property) return null;
  if (base === 'namespace:admission' && property === 'syncIntentAdmission') return 'admission';
  return importedIdentity(base.replace(/^namespace:/, ''), property) ?? `${base}.${property}`;
}

function resolveExpression(expression, bindings) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return bindings.get(current.text) ?? null;
  const dynamicKind = dynamicImportKind(current);
  if (dynamicKind) return `namespace:${dynamicKind}`;
  return resolveConstructedExpression(current, bindings)
    ?? resolvePropertyExpression(current, bindings);
}

function bindName(name, identity, bindings) {
  if (!identity) return false;
  if (ts.isIdentifier(name)) {
    if (bindings.get(name.text) === identity) return false;
    bindings.set(name.text, identity);
    return true;
  }
  if (!ts.isObjectBindingPattern(name)) return false;
  let changed = false;
  for (const element of name.elements) {
    const property = propertyText(element.propertyName ?? element.name);
    if (!property) continue;
    const resolved = importedIdentity(identity.replace(/^namespace:/, ''), property)
      ?? (identity === 'namespace:admission' && property === 'syncIntentAdmission'
        ? 'admission'
        : `${identity}.${property}`);
    changed = bindName(element.name, resolved, bindings) || changed;
  }
  return changed;
}

function bindDefaultImport(clause, kind, specifier, bindings) {
  if (!clause.name || !kind) return;
  if (kind !== 'executor') {
    bindings.set(clause.name.text, kind === 'admission' ? 'admission' : `namespace:${kind}`);
    return;
  }
  const imported = /(?:^|\/)(syncAddress|syncWallet)(?:\.[cm]?[jt]s)?$/.exec(specifier)?.[1];
  if (imported) bindings.set(clause.name.text, `executor.${imported}`);
}

function fallbackImportKind(file, imported) {
  if (file.startsWith('server/src/') && ['syncAddress', 'syncWallet'].includes(imported)) {
    return `executor.${imported}`;
  }
  if (file.startsWith('server/src/')) return importedIdentity('legacy', imported);
  if (file.startsWith('src/')) return importedIdentity('frontend', imported);
  return null;
}

function bindNamedImports(namedImports, kind, file, bindings) {
  for (const element of namedImports.elements) {
    const imported = (element.propertyName ?? element.name).text;
    const identity = kind
      ? importedIdentity(kind, imported)
      : fallbackImportKind(file, imported);
    if (identity) bindings.set(element.name.text, identity);
  }
}

function bindImportDeclaration(statement, file, bindings) {
  if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return;
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return;
  const specifier = statement.moduleSpecifier.text;
  const kind = moduleKind(specifier);
  bindDefaultImport(clause, kind, specifier, bindings);
  if (!clause.namedBindings) return;
  if (ts.isNamespaceImport(clause.namedBindings)) {
    if (kind) bindings.set(clause.namedBindings.name.text, `namespace:${kind}`);
    return;
  }
  bindNamedImports(clause.namedBindings, kind, file, bindings);
}

function collectImportBindings(sourceFile, file) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) bindImportDeclaration(statement, file, bindings);
  }
  return bindings;
}

function propagateBindings(sourceFile, bindings) {
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed = bindName(node.name, resolveExpression(node.initializer, bindings), bindings) || changed;
      } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
        changed = bindName(node.left, resolveExpression(node.right, bindings), bindings) || changed;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (!changed) break;
  }
}

function collectBindings(sourceFile, file) {
  const bindings = collectImportBindings(sourceFile, file);
  propagateBindings(sourceFile, bindings);
  return bindings;
}

function enclosingFunctionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
      return current.name.getText();
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      return current.parent.name.text;
    }
  }
  return '<module>';
}

function expressionProperty(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) {
    return null;
  }
  return propertyText(ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression.argumentExpression);
}

function resolveTrackedCallsiteSink(node, file, bindings) {
  const resolved = resolveExpression(node.expression, bindings);
  if (resolved || !file.startsWith('server/src/')) return resolved;
  const property = expressionProperty(node.expression);
  if (['syncAddress', 'syncWallet'].includes(property)) return `executor.${property}`;
  return property ? importedIdentity('legacy', property) : null;
}

function isSameFieldProjection(value, field, strings) {
  return (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
    && staticPropertyText(
      ts.isPropertyAccessExpression(value) ? value.name : value.argumentExpression,
      strings,
    )
      === field;
}

function isGenerationMutationObject(value, strings) {
  return ts.isObjectLiteralExpression(value) && value.properties.some(property => (
    ts.isPropertyAssignment(property)
    && ['increment', 'set'].includes(staticPropertyText(property.name, strings))
  ));
}

function staticPropertyText(node, strings) {
  if (ts.isComputedPropertyName(node)) return staticString(node.expression, strings);
  return propertyText(node);
}

function isRequestedIncrementalGenerationWrite(node, file, strings) {
  if (!file.startsWith('server/src/')) return false;
  const field = 'requestedIncrementalSyncGeneration';
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text === field;
  if (!ts.isPropertyAssignment(node) || staticPropertyText(node.name, strings) !== field) return false;
  const value = unwrapExpression(node.initializer);
  if (value.kind === ts.SyntaxKind.TrueKeyword || isSameFieldProjection(value, field, strings)) {
    return false;
  }
  if (ts.isObjectLiteralExpression(value)) return isGenerationMutationObject(value, strings);
  return true;
}

function collectTrackedCallsites(productionSources) {
  const counts = new Map();
  const record = (sink, file, node) => {
    const callsite = { sink, file, enclosingFunction: enclosingFunctionName(node) };
    const identity = producerCallsiteIdentity(callsite);
    counts.set(identity, { ...callsite, count: (counts.get(identity)?.count ?? 0) + 1 });
  };
  for (const [file, source] of productionSources) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const bindings = collectBindings(sourceFile, file);
    const strings = staticStringBindings(sourceFile);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const sink = resolveTrackedCallsiteSink(node, file, bindings);
        if (sink && (TRACKED_PRODUCER_SINKS.has(sink) || TRACKED_EXECUTOR_SINKS.has(sink))) {
          record(sink, file, node);
        }
      } else if (isRequestedIncrementalGenerationWrite(node, file, strings)) {
        record('authority.requestedIncrementalSyncGenerationWrite', file, node);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return [...counts.values()].sort((left, right) => (
    producerCallsiteIdentity(left).localeCompare(producerCallsiteIdentity(right))
  ));
}

function validateProducerCallsites(productionSources, inventory, errors) {
  const actual = collectTrackedCallsites(productionSources)
    .filter(callsite => TRACKED_PRODUCER_SINKS.has(callsite.sink));
  const expected = inventory.producerCallsites.map(({ sink, file, enclosingFunction, count }) => ({
    sink, file, enclosingFunction, count,
  })).sort((left, right) => producerCallsiteIdentity(left).localeCompare(producerCallsiteIdentity(right)));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`wallet-history producer callsites changed: expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
  }
}

function staticString(node, bindings = new Map(), active = new Set()) {
  if (!node) return null;
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    if (active.has(value.text)) return null;
    return staticString(bindings.get(value.text), bindings, new Set(active).add(value.text));
  }
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(value.left, bindings, active);
    const right = staticString(value.right, bindings, active);
    return left === null || right === null ? null : left + right;
  }
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)
    || value.expression.name.text !== 'join'
    || !ts.isArrayLiteralExpression(value.expression.expression)) return null;
  const separator = value.arguments.length === 0
    ? ','
    : staticString(value.arguments[0], bindings, active);
  if (separator === null) return null;
  const parts = value.expression.expression.elements
    .map(element => staticString(element, bindings, active));
  return parts.some(part => part === null) ? null : parts.join(separator);
}

function staticStringBindings(sourceFile) {
  const bindings = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)) {
      bindings.set(node.left.text, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function collectBullMqImports(sourceFile) {
  const constructors = new Set();
  const namespaces = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== 'bullmq'
      || !statement.importClause) continue;
    if (statement.importClause.name) namespaces.add(statement.importClause.name.text);
    const named = statement.importClause.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'Queue') {
          constructors.add(element.name.text);
        }
      }
    }
  }
  return { constructors, namespaces };
}

function aliasesQueueConstructor(node, queueTypes) {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return queueTypes.constructors.has(value.text);
  return ts.isPropertyAccessExpression(value)
    && ts.isIdentifier(value.expression)
    && queueTypes.namespaces.has(value.expression.text)
    && value.name.text === 'Queue';
}

function bindDestructuredQueueConstructor(node, queueTypes) {
  if (!ts.isVariableDeclaration(node) || !ts.isObjectBindingPattern(node.name)
    || !node.initializer || !ts.isIdentifier(unwrapExpression(node.initializer))
    || !queueTypes.namespaces.has(unwrapExpression(node.initializer).text)) return false;
  let changed = false;
  for (const element of node.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const imported = element.propertyName?.getText() ?? element.name.text;
    if (imported === 'Queue' && !queueTypes.constructors.has(element.name.text)) {
      queueTypes.constructors.add(element.name.text);
      changed = true;
    }
  }
  return changed;
}

function bindNamedQueueConstructor(node, queueTypes) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer
    || !aliasesQueueConstructor(node.initializer, queueTypes)
    || queueTypes.constructors.has(node.name.text)) return false;
  queueTypes.constructors.add(node.name.text);
  return true;
}

function propagateQueueConstructorAliases(sourceFile, queueTypes) {
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    const visit = node => {
      changed = bindDestructuredQueueConstructor(node, queueTypes) || changed;
      changed = bindNamedQueueConstructor(node, queueTypes) || changed;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!changed) break;
  }
}

function bullMqQueueConstructors(sourceFile) {
  const queueTypes = collectBullMqImports(sourceFile);
  propagateQueueConstructorAliases(sourceFile, queueTypes);
  return queueTypes;
}

function isQueueConstructor(node, queueTypes) {
  if (ts.isIdentifier(node)) return queueTypes.constructors.has(node.text);
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && queueTypes.namespaces.has(node.expression.text)
    && node.name.text === 'Queue';
}

function isWalletQueueConstruction(node, queueTypes, strings) {
  return ts.isNewExpression(node)
    && isQueueConstructor(node.expression, queueTypes)
    && typeof staticString(node.arguments?.[0], strings) === 'string'
    && staticString(node.arguments?.[0], strings).includes('sync');
}

function walletQueueBindings(sourceFile, queueTypes, strings) {
  const names = new Set();
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = unwrapExpression(node.initializer);
        const walletQueue = isWalletQueueConstruction(value, queueTypes, strings)
          || (ts.isIdentifier(value) && names.has(value.text));
        if (walletQueue && !names.has(node.name.text)) {
          names.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!changed) break;
  }
  return names;
}

function isPotentialWalletQueueMutation(node, file, queueNames, queueTypes, strings) {
  if (file === 'server/src/services/workerSyncQueue.ts') return true;
  const receiver = ts.isPropertyAccessExpression(node.expression)
    ? unwrapExpression(node.expression.expression)
    : null;
  if (receiver && ts.isIdentifier(receiver) && queueNames.has(receiver.text)) return true;
  if (receiver && isWalletQueueConstruction(receiver, queueTypes, strings)) {
    return true;
  }
  const jobName = node.expression.name.text === 'add'
    ? staticString(node.arguments[0], strings)
    : null;
  return jobName === 'sync-wallet';
}

function collectRawQueueMutations(productionSources) {
  const counts = new Map();
  for (const [file, source] of productionSources) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const queueTypes = bullMqQueueConstructors(sourceFile);
    const strings = staticStringBindings(sourceFile);
    const queueNames = walletQueueBindings(sourceFile, queueTypes, strings);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if ((method === 'add' || method === 'addBulk')
          && isPotentialWalletQueueMutation(node, file, queueNames, queueTypes, strings)) {
          const entry = { file, enclosingFunction: enclosingFunctionName(node), method };
          const identity = rawQueueMutationIdentity(entry);
          counts.set(identity, { ...entry, count: (counts.get(identity)?.count ?? 0) + 1 });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return [...counts.values()].sort((left, right) => (
    rawQueueMutationIdentity(left).localeCompare(rawQueueMutationIdentity(right))
  ));
}

function validateRawQueueMutations(productionSources, inventory, errors) {
  const actual = collectRawQueueMutations(productionSources);
  const expected = inventory.rawQueueMutations.map(({ file, enclosingFunction, method, count }) => ({
    file, enclosingFunction, method, count,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`raw wallet-sync queue mutations changed: expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
  }
}

function trackedCommonJsImport(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'require' && ts.isStringLiteralLike(node.arguments[0])) {
    return moduleKind(node.arguments[0].text);
  }
  if (!ts.isImportEqualsDeclaration(node)
    || !ts.isExternalModuleReference(node.moduleReference)
    || !ts.isStringLiteralLike(node.moduleReference.expression)) return null;
  return moduleKind(node.moduleReference.expression.text);
}

function validateNoTrackedCommonJsImports(productionSources, errors) {
  const imports = [];
  for (const [file, source] of productionSources) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      const kind = trackedCommonJsImport(node);
      if (kind) imports.push(`${file}: ${kind}`);
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  if (imports.length) {
    errors.push(`tracked wallet-history modules require static ES imports: ${imports.sort().join(', ')}`);
  }
}

function validateForbiddenClientHistory(productionSources, inventory, errors) {
  const clients = new Map([...productionSources].filter(([file]) => (
    file.startsWith('src/') || file.startsWith('gateway/src/')
  )));
  for (const symbol of inventory.forbiddenClientWalletHistory.symbols) {
    const files = actualReferenceFiles(clients, new RegExp(`\\b${escapeRegExp(symbol)}\\b`));
    if (files.length) errors.push(`forbidden client wallet-history symbol ${symbol}: ${files.join(', ')}`);
  }
  for (const requestPath of inventory.forbiddenClientWalletHistory.paths) {
    const files = actualReferenceFiles(clients, new RegExp(escapeRegExp(requestPath)));
    if (files.length) errors.push(`forbidden client wallet-history request ${requestPath}: ${files.join(', ')}`);
  }
}

function trackedReexports(statement, file) {
  if (!ts.isExportDeclaration(statement) || statement.isTypeOnly
    || !statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) return [];
  const kind = moduleKind(statement.moduleSpecifier.text);
  if (!kind) return [];
  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
    return [`${file}: export * from ${statement.moduleSpecifier.text}`];
  }
  return statement.exportClause.elements.flatMap((element) => {
    if (element.isTypeOnly) return [];
    const exported = (element.propertyName ?? element.name).text;
    const identity = importedIdentity(kind, exported);
    const tracked = identity && (TRACKED_PRODUCER_SINKS.has(identity)
      || TRACKED_EXECUTOR_SINKS.has(identity) || identity === 'admission');
    return tracked ? [`${file}: ${identity}`] : [];
  });
}

function validateNoTrackedProducerReexports(productionSources, errors) {
  const reexports = [...productionSources].flatMap(([file, source]) => {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return sourceFile.statements.flatMap(statement => trackedReexports(statement, file));
  });
  if (reexports.length) {
    errors.push(`tracked wallet-history producer re-export added: ${reexports.sort().join(', ')}`);
  }
}

function actualReferenceFiles(sources, pattern) {
  return [...sources]
    .filter(([, source]) => pattern.test(source))
    .map(([file]) => file)
    .sort();
}

function subscriptionSymbolEntries(inventory, symbol) {
  const definition = inventory.symbolReferences.find(item => item.symbol === symbol);
  if (!definition) throw new Error(`inventory.symbolReferences must include ${symbol}`);
  return expectedFiles(definition.entries);
}

function validateSubscriptionInventory(inventory, ownership) {
  const repository = ownership.subscriptionCheckpointRepository;
  const coordinator = ownership.subscriptionEnrollmentCoordinator;
  const runtime = ownership.subscriptionCheckpointRuntime;
  for (const writer of SUBSCRIPTION_ENROLLMENT_WRITERS) {
    const expected = [REPOSITORY_BARREL_PATH, repository, runtime];
    if (writer === 'completeSubscriptionEnrollment') expected.push(coordinator);
    assertExact(
      subscriptionSymbolEntries(inventory, writer),
      expected.sort(),
      `subscription enrollment writer ${writer}`,
    );
  }
  assertExact(
    subscriptionSymbolEntries(inventory, SUBSCRIPTION_ENROLLMENT_COORDINATOR_SYMBOL),
    [coordinator, runtime].sort(),
    'subscription enrollment coordinator references',
  );
  assertExact(
    subscriptionSymbolEntries(inventory, 'findPendingSubscriptionEnrollments'),
    [coordinator, repository, runtime].sort(),
    'pending subscription enrollment reader references',
  );
  assertExact(
    subscriptionSymbolEntries(inventory, 'findSubscriptionCheckpointOwners'),
    [repository, runtime].sort(),
    'subscription checkpoint owner reader references',
  );
  assertExact(
    subscriptionSymbolEntries(inventory, SUBSCRIPTION_CHECKPOINT_RUNTIME_FACTORY_SYMBOL),
    [runtime],
    'subscription checkpoint runtime factory references',
  );
  assertExact(
    subscriptionSymbolEntries(
      inventory,
      PRODUCTION_SUBSCRIPTION_CHECKPOINT_RUNTIME_FACTORY_SYMBOL,
    ),
    [runtime, WORKER_PATH].sort(),
    'production subscription checkpoint runtime factory references',
  );
}

function unexpectedSubscriptionBoundaryConsumers(sources, ownership) {
  const repository = ownership.subscriptionCheckpointRepository;
  const coordinator = ownership.subscriptionEnrollmentCoordinator;
  const runtime = ownership.subscriptionCheckpointRuntime;
  const writers = new RegExp(`\\b(?:${SUBSCRIPTION_ENROLLMENT_WRITERS.join('|')})\\b`);
  const executableSources = new Map([...sources].map(([file, source]) => [
    file,
    source.replace(/\bexport\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?/g, ''),
  ]));
  const writerConsumers = actualReferenceFiles(executableSources, writers);
  const coordinatorConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*subscriptionCheckpointEnrollment(?:\.[cm]?[jt]s)?['"]|\bcreateSubscriptionCheckpointEnrollment\b/,
  );
  const runtimeConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*subscriptionCheckpointRuntime(?:\.[cm]?[jt]s)?['"]/,
  );
  const allowedWriters = new Set([repository, coordinator, runtime]);
  const allowedCoordinatorConsumers = new Set([coordinator, runtime]);
  return [...new Set([
    ...writerConsumers.filter(file => !allowedWriters.has(file)),
    ...coordinatorConsumers.filter(file => !allowedCoordinatorConsumers.has(file)),
    ...runtimeConsumers.filter(file => file !== WORKER_PATH),
  ])].sort();
}

function addressDelegateAliases(sourceFile) {
  const aliases = new Set();
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    const bind = (name) => {
      if (!ts.isIdentifier(name) || aliases.has(name.text)) return;
      aliases.add(name.text);
      changed = true;
    };
    const isAddressDelegate = (expression) => {
      const current = unwrapExpression(expression);
      return (ts.isIdentifier(current) && aliases.has(current.text))
        || expressionProperty(current) === 'address';
    };
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (isAddressDelegate(node.initializer)) bind(node.name);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (propertyText(element.propertyName ?? element.name) === 'address') bind(element.name);
          }
        }
      } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && isAddressDelegate(node.right)) {
        bind(node.left);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (!changed) break;
  }
  return aliases;
}

function collectAddressCreationAuthorities(productionSources) {
  const authorities = new Map();
  for (const [file, source] of productionSources) {
    if (file.startsWith('server/src/generated/')) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const aliases = addressDelegateAliases(sourceFile);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const method = expressionProperty(node.expression);
        const receiver = (ts.isPropertyAccessExpression(node.expression)
          || ts.isElementAccessExpression(node.expression))
          ? unwrapExpression(node.expression.expression)
          : null;
        const addressDelegate = receiver && (
          expressionProperty(receiver) === 'address'
          || (ts.isIdentifier(receiver) && aliases.has(receiver.text))
        );
        if (addressDelegate && ['create', 'createMany', 'createManyAndReturn'].includes(method)) {
          const enclosingFunction = enclosingFunctionName(node);
          const key = `${file}\0${enclosingFunction}\0${method}`;
          authorities.set(key, (authorities.get(key) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return authorities;
}

function validateCheckpointedAddressWriters(productionSources, inventory, errors) {
  const actual = collectAddressCreationAuthorities(productionSources);
  const expected = new Map(inventory.addressCreationAuthorities.map((entry) => [
    `${entry.file}\0${entry.enclosingFunction}\0${entry.method}`,
    entry.count,
  ]));
  const identities = [...new Set([...actual.keys(), ...expected.keys()])].sort();
  const mismatches = identities.filter((identity) => actual.get(identity) !== expected.get(identity));
  if (mismatches.length > 0) {
    errors.push(`address creation authority inventory changed: ${mismatches.map((identity) => {
      const [file, enclosingFunction, method] = identity.split('\0');
      return `${file}:${enclosingFunction}:${method} expected=${expected.get(identity) ?? 0} actual=${actual.get(identity) ?? 0}`;
    }).join(', ')}`);
  }
}

function unexpectedAdmissionConsumers(
  sources,
  admissionModule,
  generationConsumerModule,
  producerCallsites,
) {
  const moduleConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*syncIntentAdmission(?:\.[cm]?[jt]s)?['"]/,
  );
  const mutationPattern = new RegExp(
    `\\b(?:${SYNC_INTENT_REPOSITORY_BOUNDARY_SYMBOLS.join('|')})\\b`,
  );
  const mutationConsumers = actualReferenceFiles(sources, mutationPattern);
  const wakeupAdapterConsumers = actualReferenceFiles(
    sources,
    /\benqueueIncrementalSyncWakeup\b/,
  );
  const expiredFenceConsumers = actualReferenceFiles(
    sources,
    /\bexpectedExpiredFence\b/,
  );
  const protectedRepositoryAuthorities = [
    {
      symbol: 'resetIncrementalSyncAttempt',
      allowed: new Set([admissionModule, SYNC_INTENT_REPOSITORY_PATH]),
    },
    {
      symbol: 'requestFullResyncGeneration',
      allowed: new Set([admissionModule, RESYNC_REPOSITORY_PATH]),
    },
    {
      symbol: 'reserveFullResyncGeneration',
      allowed: new Set([INCREMENTAL_WAKEUP_ADAPTER_PATH, RESYNC_REPOSITORY_PATH]),
    },
  ];
  const repositoryAuthorityConsumers = protectedRepositoryAuthorities.flatMap(({ symbol, allowed }) => (
    actualReferenceFiles(sources, new RegExp(`\\b${symbol}\\b`))
      .filter(file => !allowed.has(file))
  ));
  const allowedModuleConsumers = new Set([
    admissionModule,
    generationConsumerModule,
    RECOVERY_COORDINATOR_PATH,
    RECOVERY_RUNTIME_PATH,
    ...producerCallsites.filter(callsite => callsite.sink.startsWith('admission.'))
      .map(callsite => callsite.file),
  ]);
  const allowedMutationConsumers = new Set([admissionModule, SYNC_INTENT_REPOSITORY_PATH]);
  const allowedWakeupAdapterConsumers = new Set([
    admissionModule,
    INCREMENTAL_WAKEUP_ADAPTER_PATH,
  ]);
  const allowedAdmissionMethods = new Map([
    [generationConsumerModule, new Set([
      'claimFresh',
      'complete',
      'reclaimExpired',
      'releaseAsActionRequired',
      'releaseForRetry',
      'wake',
    ])],
    [RECOVERY_RUNTIME_PATH, new Set(['recover', 'recoverExpired', 'wakeReservedFullResync'])],
  ]);
  for (const callsite of producerCallsites) {
    if (!callsite.sink.startsWith('admission.')) continue;
    const methods = allowedAdmissionMethods.get(callsite.file) ?? new Set();
    methods.add(callsite.sink.slice('admission.'.length));
    allowedAdmissionMethods.set(callsite.file, methods);
  }
  const forbiddenAdmissionCalls = [...sources]
    .filter(([file, source]) => admissionSingletonAliases(source).some(alias => (
      hasForbiddenAdmissionAccess(
        source,
        alias,
        ADMISSION_SINGLETON_METHODS.filter(
          method => !allowedAdmissionMethods.get(file)?.has(method),
        ),
      )
    )))
    .map(([file]) => file);
  const recoveryCoordinatorConsumers = actualReferenceFiles(
    sources,
    new RegExp(`\\b${RECOVERY_COORDINATOR_SYMBOL}\\b`),
  ).filter(file => file !== RECOVERY_COORDINATOR_PATH && file !== RECOVERY_RUNTIME_PATH);
  const recoveryRuntimeConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*walletSyncRecoveryRuntime(?:\.[cm]?[jt]s)?['"]|\bcreateProductionWalletSyncRecoveryRuntime\b/,
  ).filter(file => file !== RECOVERY_RUNTIME_PATH && file !== WORKER_PATH);
  return [...new Set([
    ...moduleConsumers.filter(file => !allowedModuleConsumers.has(file)),
    ...mutationConsumers.filter(file => !allowedMutationConsumers.has(file)),
    ...wakeupAdapterConsumers.filter(file => !allowedWakeupAdapterConsumers.has(file)),
    ...expiredFenceConsumers.filter(file => !allowedMutationConsumers.has(file)),
    ...repositoryAuthorityConsumers,
    ...forbiddenAdmissionCalls,
    ...recoveryCoordinatorConsumers,
    ...recoveryRuntimeConsumers,
  ])]
    .sort();
}

function validateRecoveryComposition(sources, admissionModule, errors) {
  const runtime = sources.get(RECOVERY_RUNTIME_PATH) ?? '';
  const admission = sources.get(admissionModule) ?? '';
  const requiredRuntimePatterns = [
    [
      /await\s+walletSyncActivationGate\.inspect\(\)[\s\S]{0,80}status\s*===\s*['"]active['"]/,
      'recovery runtime authorization must inspect the live activation gate',
    ],
    [
      /if\s*\(\s*!\s*await\s+authorize\(\)\s*\)\s*return\s*\{\s*status\s*:\s*['"]blocked['"]\s*\}[\s\S]{0,180}await\s+syncIntentAdmission\.wakeReservedFullResync\s*\(\s*wakeup\s*\)/,
      'full-resync recovery must recheck activation then use exact canonical admission',
    ],
    [
      /syncIntentAdmission\.recover\s*\(/,
      'recovery runtime must use gate-enforced incremental recovery',
    ],
    [
      /syncIntentAdmission\.recoverExpired\s*\(/,
      'recovery runtime must use gate-enforced expired recovery',
    ],
    [
      /activate\s*:\s*\(\)\s*=>\s*walletSyncActivationGate\.activate\s*\(\)/,
      'recovery runtime activation must use the canonical activation gate',
    ],
  ];
  for (const [pattern, message] of requiredRuntimePatterns) {
    if (!pattern.test(runtime)) errors.push(message);
  }
  if (countMatches(runtime, /\bsyncIntentAdmission\.wakeReservedFullResync\s*\(/g) !== 1) {
    errors.push('recovery runtime must contain exactly one exact full-resync repair admission');
  }
  if (countMatches(runtime, /\bcreateSyncIntentRecoveryCoordinator\s*\(/g) !== 1) {
    errors.push('recovery runtime must construct exactly one bounded coordinator');
  }
  if (!/inspectActivation\s*:\s*\(\)\s*=>\s*walletSyncActivationGate\.inspect\s*\(\)/.test(admission)) {
    errors.push('canonical admission must inspect the activation gate');
  }
  if (!/publishTransition\s*:\s*syncLifecyclePublisher\.publish/.test(admission)) {
    errors.push('canonical admission must publish committed durable request state');
  }
  if (countMatches(admission, /transition\s*:\s*['"]requested['"]/g) !== 2) {
    errors.push('incremental and full-resync admission must each publish requested state');
  }
  const incrementalPersistence = admission.indexOf('repository.requestIncrementalSync(');
  const fullPersistence = admission.indexOf('persistFullResyncRequest(walletId)');
  const publications = [...admission.matchAll(/await\s+publishTransition\s*\(/g)]
    .map(match => match.index ?? -1);
  if (publications.length !== 2
    || publications[0] <= incrementalPersistence
    || publications[1] <= fullPersistence) {
    errors.push('canonical admission must publish only after each durable request commits');
  }
}

function importsReservedFullResyncAuthority(node) {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)
    || node.importClause?.isTypeOnly) return false;
  const bindings = node.importClause?.namedBindings;
  const importsReservedWakeup = Boolean(bindings && ts.isNamedImports(bindings))
    && bindings.elements.some(element => !element.isTypeOnly
      && (element.propertyName ?? element.name).text === 'enqueueReservedFullResyncWakeup');
  const importsRawQueueModule = moduleKind(node.moduleSpecifier.text) === 'legacy'
    && (!bindings || ts.isNamespaceImport(bindings));
  return importsReservedWakeup || importsRawQueueModule;
}

function dynamicallyImportsLegacyQueue(node) {
  return ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && ts.isStringLiteralLike(node.arguments[0])
    && moduleKind(node.arguments[0].text) === 'legacy';
}

function callsReservedFullResyncWakeup(node, file) {
  if (file === RECOVERY_COORDINATOR_PATH || !ts.isCallExpression(node)) return false;
  return expressionProperty(unwrapExpression(node.expression)) === 'enqueueReservedFullResyncWakeup';
}

function fileUsesReservedFullResyncAuthority(sourceFile, file) {
  let found = false;
  function visit(node) {
    if (importsReservedFullResyncAuthority(node)
      || dynamicallyImportsLegacyQueue(node)
      || callsReservedFullResyncWakeup(node, file)) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function validateReservedFullResyncQueueAuthority(productionSources, admissionModule, errors) {
  const consumers = [];
  for (const [file, source] of productionSources) {
    if (file === admissionModule) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (fileUsesReservedFullResyncAuthority(sourceFile, file)) consumers.push(file);
  }
  if (consumers.length) {
    errors.push(`raw reserved full-resync queue authority escaped canonical admission: ${[...new Set(consumers)].sort().join(', ')}`);
  }
}

function unexpectedActivationConsumers(sources) {
  const gateConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*walletSyncActivationGate(?:\.[cm]?[jt]s)?['"]/,
  ).filter(file => !new Set([
    ACTIVATION_GATE_PATH,
    'server/src/services/sync/syncIntentAdmission.ts',
    'server/src/worker/healthServer.ts',
    RECOVERY_RUNTIME_PATH,
  ]).has(file));
  const policyConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*walletSyncActivationPolicyRepository(?:\.[cm]?[jt]s)?['"]/,
  ).filter(file => !isPermittedActivationPolicyConsumer(file, sources.get(file)));
  const policyAliasConsumers = actualReferenceFiles(
    sources,
    /\bwalletSyncActivationPolicyRepo\b/,
  ).filter(file => file !== ACTIVATION_POLICY_REPOSITORY_PATH
    && file !== ACTIVATION_GATE_PATH);
  const stabilizationConsumers = actualReferenceFiles(
    sources,
    /['"][^'"]*walletSyncActivationStabilizationRepository(?:\.[cm]?[jt]s)?['"]|\bwalletSyncActivationStabilizationRepository\b/,
  ).filter(file => file !== ACTIVATION_STABILIZATION_REPOSITORY_PATH
    && file !== ACTIVATION_GATE_PATH);
  return [...new Set([
    ...gateConsumers,
    ...policyConsumers,
    ...policyAliasConsumers,
    ...stabilizationConsumers,
  ])].sort();
}

function isPermittedActivationPolicyConsumer(file, source = '') {
  if (file === ACTIVATION_POLICY_REPOSITORY_PATH
    || file === ACTIVATION_GATE_PATH) return true;
  const validationOnlyConsumers = new Set([
    'server/src/services/backupService/creation.ts',
    'server/src/services/backupService/restore.ts',
    'server/src/services/backupService/restoreTransforms.ts',
  ]);
  if (!validationOnlyConsumers.has(file)) return false;
  const allowedImports = new Set([
    'assertCurrentBinarySupportsWalletSyncActivation',
    'parseWalletSyncActivation',
  ]);
  const imports = /\bimport\s+([^;]*?)\s+from\s+['"]([^'"]*walletSyncActivationPolicyRepository(?:\.[cm]?[jt]s)?)['"]\s*;?/g;
  const matches = [...source.matchAll(imports)];
  return matches.length > 0 && matches.every(([, clause]) => {
    const named = /^\s*\{([\s\S]*)\}\s*$/.exec(clause)?.[1];
    if (named === undefined) return false;
    const symbols = named.split(',')
      .map(entry => entry.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    return symbols.length > 0 && symbols.every(symbol => allowedImports.has(symbol));
  });
}

function admissionSingletonAliases(source) {
  const aliases = [];
  const imports = /\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;
  for (const match of source.matchAll(imports)) {
    if (!/syncIntentAdmission(?:\.[cm]?[jt]s)?$/.test(match[2])) continue;
    aliases.push(...namedImportAliases(match[1], 'syncIntentAdmission'));
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(match[1])?.[1];
    if (namespace) aliases.push(`${namespace}.syncIntentAdmission`);
  }
  for (let index = 0; index < aliases.length; index += 1) {
    const alias = aliases[index];
    const assignments = new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegExp(alias)}\\b`,
      'g',
    );
    for (const match of source.matchAll(assignments)) {
      if (!aliases.includes(match[1])) aliases.push(match[1]);
    }
  }
  return aliases;
}

function hasForbiddenAdmissionAccess(source, alias, methods) {
  const root = `\\b${escapeRegExp(alias)}`;
  const methodPattern = `(?:${methods.join('|')})`;
  return new RegExp(`${root}\\s*(?:\\?\\.|\\.)${methodPattern}\\b`).test(source)
    || new RegExp(`${root}\\s*(?:\\?\\.)?\\[\\s*['"]${methodPattern}['"]\\s*\\]`).test(source)
    || new RegExp(
      `\\{[^}]*\\b${methodPattern}\\b[^}]*\\}\\s*=\\s*${root}`,
    ).test(source);
}

function expectedFiles(entries) {
  return entries.map(({ file }) => file);
}

function compareReferenceInventory(sources, definitions, identity, patternFor, errors) {
  for (const definition of definitions) {
    const value = definition[identity];
    const actual = actualReferenceFiles(sources, patternFor(value));
    const expected = expectedFiles(definition.entries);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`${identity} ${value} references changed: expected ${expected.join(', ') || '(none)'}; found ${actual.join(', ') || '(none)'}`);
    }
  }
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function namedImportAliases(clause, callee) {
  const named = /\{([\s\S]*?)\}/.exec(clause)?.[1];
  if (!named) return [];
  return named.split(',').flatMap((part) => {
    const match = new RegExp(`^(?:type\\s+)?${escapeRegExp(callee)}(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?$`)
      .exec(part.trim());
    return match ? [match[1] ?? callee] : [];
  });
}

function compareDirectCalls(productionSources, definitions, errors) {
  const executorCalls = collectTrackedCallsites(productionSources)
    .filter(callsite => TRACKED_EXECUTOR_SINKS.has(callsite.sink));
  for (const definition of definitions) {
    const excluded = new Set(definition.implementationModules);
    const counts = new Map();
    for (const callsite of executorCalls) {
      if (callsite.sink !== `executor.${definition.callee}` || excluded.has(callsite.file)) continue;
      counts.set(callsite.file, (counts.get(callsite.file) ?? 0) + callsite.count);
    }
    const actual = [...counts].map(([file, count]) => ({ file, count }));
    actual.sort((left, right) => left.file.localeCompare(right.file));
    const expected = definition.entries.map(({ file, count }) => ({ file, count }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`direct ${definition.callee} call inventory changed: expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
    }
  }
}

function validateDocumentation(root, contract, errors) {
  const adr = readRequired(root, ADR_PATH);
  const architecture = readRequired(root, ARCHITECTURE_PATH);
  for (const invariant of contract.requiredInvariantIds) {
    if (!adr.includes(`\`${invariant}\``)) errors.push(`${ADR_PATH} must document ${invariant}`);
  }
  if (!architecture.includes('docs/adr/0004-wallet-sync-lifecycle.md')) {
    errors.push(`${ARCHITECTURE_PATH} must link ADR 0004`);
  }
  if (!architecture.includes(CONTRACT_PATH)) {
    errors.push(`${ARCHITECTURE_PATH} must link ${CONTRACT_PATH}`);
  }
}

function validateWireSource(root, errors) {
  const source = readRequired(root, 'server/src/jobs/syncJobContract.ts');
  if (!/SYNC_JOB_CONTRACT_VERSION\s*=\s*1\s+as\s+const/.test(source)) {
    errors.push('retained compatibility jobs must preserve wire version 1');
  }
  if (!/SYNC_WALLET_JOB_READER_VERSION\s*=\s*2\s+as\s+const/.test(source)) {
    errors.push('sync wallet consumers must expose the version 2 generation contract');
  }
  if (!/SYNC_WALLET_MUTATION_FENCE_JOB_VERSION\s*=\s*3\s+as\s+const/.test(source)) {
    errors.push('canonical fenced wake-ups must use wire version 3');
  }
  if (!source.includes('requiredMutationFenceFloor')) {
    errors.push('canonical fenced wake-ups must carry their required mutation-fence floor');
  }
}

function parseContractSource(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function expressionPath(expression) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (current.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null;
  }
  const receiver = expressionPath(current.expression);
  const property = propertyText(ts.isPropertyAccessExpression(current)
    ? current.name
    : current.argumentExpression);
  return receiver && property ? `${receiver}.${property}` : null;
}

function collectContractNodes(file, source, predicate) {
  const sourceFile = parseContractSource(file, source);
  const nodes = [];
  const visit = (node) => {
    if (predicate(node, sourceFile)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

function callsPath(file, source, pathName, functionName) {
  return collectContractNodes(file, source, (node) => (
    ts.isCallExpression(node)
    && expressionPath(node.expression) === pathName
    && (functionName === undefined || enclosingFunctionName(node) === functionName)
  ));
}

function callHasArgumentPath(call, pathName) {
  return call.arguments.some((argument) => expressionPath(argument) === pathName);
}

function hasStrictRepresentedNetworkMap(file, source) {
  return collectContractNodes(file, source, (node) => (
    ts.isCallExpression(node)
    && expressionPath(node.expression) === 'representedNetworkValues.map'
    && node.arguments.length === 1
    && expressionPath(node.arguments[0]) === 'resolvePersistedBitcoinNetwork'
    && enclosingFunctionName(node) === 'startWithLock'
  )).length > 0;
}

function hasWorkerStatusCallback(file, source) {
  return collectContractNodes(file, source, (node) => {
    if (!ts.isNewExpression(node)
      || expressionPath(node.expression) !== 'ElectrumSubscriptionManager') return false;
    const options = node.arguments?.[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return false;
    return options.properties.some((property) => (
      ts.isPropertyAssignment(property)
      && staticPropertyText(property.name, new Map()) === 'onSubscriptionStatuses'
      && expressionPath(property.initializer) === 'recordSubscriptionStatuses'
    ));
  }).length > 0;
}

function usesPersistedNetworkFallback(file, source) {
  return collectContractNodes(file, source, (node, sourceFile) => (
    ts.isBinaryExpression(node)
    && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]
      .includes(node.operatorToken.kind)
    && node.left.getText(sourceFile).includes('wallet.network')
  )).length > 0;
}

function hasBoundedRepresentedNetworkRead(file, source) {
  return callsPath(file, source, 'prisma.wallet.findMany').some((call) => {
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return false;
    return options.properties.some((property) => (
      ts.isPropertyAssignment(property)
      && staticPropertyText(property.name, new Map()) === 'take'
      && expressionPath(property.initializer) === 'REPRESENTED_NETWORK_READ_LIMIT'
    ));
  });
}

function hasFairTimerOrder(file, source, functionName, inFlightName, indexName) {
  const sourceFile = parseContractSource(file, source);
  const calls = callsPath(file, source, 'electrumManager.getManagedNetworks', functionName);
  if (calls.length !== 1) return false;
  const callPosition = calls[0].getStart(sourceFile);
  const guards = collectContractNodes(file, source, (node) => (
    ts.isIfStatement(node)
    && expressionPath(node.expression) === inFlightName
    && enclosingFunctionName(node) === functionName
  ));
  const advances = collectContractNodes(file, source, (node) => (
    ts.isBinaryExpression(node)
    && expressionPath(node.left) === indexName
    && node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
    && enclosingFunctionName(node) === functionName
  ));
  return guards.some((guard) => guard.getStart(sourceFile) < callPosition)
    && advances.length === 1
    && advances[0].getStart(sourceFile) > callPosition;
}

function descendantNodes(node, predicate) {
  const matches = [];
  const visit = (current) => {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return matches;
}

function findMethod(file, source, methodName) {
  return collectContractNodes(file, source, (node) => (
    ts.isMethodDeclaration(node) && propertyText(node.name) === methodName
  ))[0];
}

function findExistingPromiseGuard(method) {
  return descendantNodes(method.body, (node) => ts.isIfStatement(node)).find((guard) => (
    expressionPath(guard.expression) === 'existing'
    && descendantNodes(guard.thenStatement, (node) => (
      ts.isAwaitExpression(node) && expressionPath(node.expression) === 'existing'
    )).length > 0
    && descendantNodes(guard.thenStatement, ts.isReturnStatement).length > 0
  ));
}

function hasGuardedConnectionCleanup(method) {
  return descendantNodes(method.body, ts.isTryStatement).some((attempt) => {
    if (!attempt.finallyBlock) return false;
    const awaitsConnection = descendantNodes(attempt.tryBlock, (node) => (
      ts.isAwaitExpression(node) && expressionPath(node.expression) === 'connection'
    )).length > 0;
    const guardedDelete = descendantNodes(attempt.finallyBlock, (node) => (
      ts.isIfStatement(node)
      && ts.isBinaryExpression(node.expression)
      && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isCallExpression(node.expression.left)
      && expressionPath(node.expression.left.expression) === 'this.networkConnections.get'
      && expressionPath(node.expression.right) === 'connection'
      && descendantNodes(node.thenStatement, (child) => (
        ts.isCallExpression(child)
        && expressionPath(child.expression) === 'this.networkConnections.delete'
      )).length > 0
    )).length > 0;
    return awaitsConnection && guardedDelete;
  });
}

function hasSingleFlightConnection(file, source) {
  const method = findMethod(file, source, 'doConnectNetwork');
  if (!method?.body) return false;
  const existingGuard = findExistingPromiseGuard(method);
  if (!existingGuard) return false;
  const calls = descendantNodes(method.body, ts.isCallExpression);
  const setConnection = calls.find((call) => (
    expressionPath(call.expression) === 'this.networkConnections.set'
    && expressionPath(call.arguments[1]) === 'connection'
  ));
  const existingDeclaration = descendantNodes(method.body, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === 'existing'
    && node.initializer
    && ts.isCallExpression(unwrapExpression(node.initializer))
    && expressionPath(unwrapExpression(node.initializer).expression)
      === 'this.networkConnections.get'
  ))[0];
  const connectionDeclaration = descendantNodes(method.body, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === 'connection'
    && node.initializer
    && ts.isCallExpression(unwrapExpression(node.initializer))
    && expressionPath(unwrapExpression(node.initializer).expression) === 'connectNetwork'
  ))[0];
  const attempt = descendantNodes(method.body, ts.isTryStatement)[0];
  return Boolean(existingDeclaration && connectionDeclaration && setConnection && attempt)
    && existingDeclaration.pos < existingGuard.pos
    && existingGuard.pos < connectionDeclaration.pos
    && connectionDeclaration.pos < setConnection.pos
    && setConnection.pos < attempt.pos
    && hasGuardedConnectionCleanup(method);
}

function hasSingleFlightReconnectAdapter(file, source) {
  const method = findMethod(file, source, 'doScheduleReconnect');
  if (!method?.body) return false;
  return descendantNodes(method.body, (node) => (
    ts.isCallExpression(node)
    && expressionPath(node.expression) === 'scheduleReconnect'
    && node.arguments.some((argument) => (
      ts.isArrowFunction(argument)
      && descendantNodes(argument.body, (child) => (
        ts.isCallExpression(child)
        && expressionPath(child.expression) === 'this.doConnectNetwork'
      )).length > 0
    ))
  )).length > 0;
}

function validateManagerNetworkCalls(managerFile, manager, errors) {
  const requiredManagerCalls = [
    ['walletRepository.findRepresentedNetworks', 'startWithLock', 'represented networks at startup'],
    ['this.ensureNetworkConnected', 'subscribeWalletAddresses', 'dynamic wallet network connection'],
    ['this.ensureNetworkConnected', 'subscribeCheckpointAddresses', 'dynamic checkpoint network connection'],
  ];
  for (const [callPath, functionName, description] of requiredManagerCalls) {
    if (callsPath(managerFile, manager, callPath, functionName).length === 0) {
      errors.push(`multi-network subscription must retain ${description}`);
    }
  }
  const checkpointConnectionCalls = callsPath(
    managerFile,
    manager,
    'this.ensureNetworkConnected',
    'subscribeCheckpointAddresses',
  );
  if (!checkpointConnectionCalls.some((call) => (
    call.arguments[2]?.kind === ts.SyntaxKind.FalseKeyword
  ))) {
    errors.push('multi-network checkpoint subscriptions must suppress reentrant readiness');
  }
  if (!hasSingleFlightConnection(managerFile, manager)) {
    errors.push('multi-network dynamic connections must retain single-flight promise sharing');
  }
  if (!hasSingleFlightReconnectAdapter(managerFile, manager)) {
    errors.push('multi-network scheduled reconnects must route through single-flight connection');
  }
}

function validateManagerStatusCalls(managerFile, manager, errors) {
  for (const callPath of [
    'subscribeAllAddresses',
    'subscribeNetworkAddresses',
    'doReconcileSubscriptions',
    'doSubscribeWalletAddresses',
  ]) {
    if (!callsPath(managerFile, manager, callPath)
      .some((call) => callHasArgumentPath(call, 'this.callbacks.onSubscriptionStatuses'))) {
      errors.push(`multi-network subscription must forward authoritative statuses through ${callPath}`);
    }
  }
  if (callsPath(managerFile, manager, 'this.callbacks.onSubscriptionStatuses').length === 0) {
    errors.push('multi-network subscription must publish refresh statuses through its callback');
  }
  if (!hasStrictRepresentedNetworkMap(managerFile, manager)) {
    errors.push('multi-network subscription must strictly validate represented networks');
  }
}

function validateWorkerMultiNetworkCalls(worker, errors) {
  if (!hasWorkerStatusCallback(WORKER_PATH, worker)) {
    errors.push('multi-network subscription must wire worker checkpoint comparison');
  }
  for (const [functionName, inFlightName, indexName] of [
    [
      'startSubscriptionStatusRefreshTimer',
      'subscriptionStatusRefreshInFlight',
      'subscriptionStatusRefreshNetworkIndex',
    ],
    [
      'startSubscriptionCheckpointTimer',
      'subscriptionCheckpointInFlight',
      'subscriptionCheckpointNetworkIndex',
    ],
  ]) {
    if (!hasFairTimerOrder(WORKER_PATH, worker, functionName, inFlightName, indexName)) {
      errors.push(`multi-network subscription must retain network-fair recovery in ${functionName}`);
    }
  }
}

function callContainsHeaderRangeFetcher(call) {
  return descendantNodes(call, (node) => (
    ts.isCallExpression(node)
    && expressionPath(node.expression)?.endsWith('.getBlockHeaders')
  )).length > 0;
}

function callArgumentsMatch(call, ...paths) {
  return call.arguments.length === paths.length
    && paths.every((pathName, index) => expressionPath(call.arguments[index]) === pathName);
}

function hasReturningHeaderBufferBranch(ingress) {
  return collectContractNodes(RAW_HEADER_INGRESS_PATH, ingress, (node) => {
    if (!ts.isIfStatement(node) || enclosingFunctionName(node) !== 'setupEventHandlers') {
      return false;
    }
    const conditionCalls = descendantNodes(node.expression, child => (
      ts.isCallExpression(child)
      && expressionPath(child.expression) === 'pendingLiveHeaders.has'
      && callArgumentsMatch(child, 'state')
    ));
    const bufferedWrites = descendantNodes(node.thenStatement, child => (
      ts.isCallExpression(child)
      && expressionPath(child.expression) === 'pendingLiveHeaders.set'
      && callArgumentsMatch(child, 'state', 'block')
    ));
    const returns = descendantNodes(node.thenStatement, child => ts.isReturnStatement(child));
    return conditionCalls.length === 1 && bufferedWrites.length === 1 && returns.length === 1;
  }).length === 1;
}

function isStateNullSet(call) {
  return call.arguments.length === 2
    && expressionPath(call.arguments[0]) === 'state'
    && call.arguments[1].kind === ts.SyntaxKind.NullKeyword;
}

function collectRawHeaderBufferCalls(ingress) {
  const setupSets = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'pendingLiveHeaders.set',
    'setupEventHandlers',
  );
  const setupHas = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'pendingLiveHeaders.has',
    'setupEventHandlers',
  );
  const subscribeGets = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'pendingLiveHeaders.get',
    'subscribeHeaders',
  );
  const subscribeClears = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'pendingLiveHeaders.set',
    'subscribeHeaders',
  );
  const subscribeDeletes = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'pendingLiveHeaders.delete',
    'subscribeHeaders',
  );
  const startupCall = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'callbacks.onHeaderObservation',
    'subscribeHeaders',
  )[0];
  const bufferedCall = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'observeLiveHeader',
    'subscribeHeaders',
  )[0];
  const handoffCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'state.client.emit',
    'subscribeHeaders',
  );
  const drainDeletes = subscribeGets[1] && handoffCalls[0]
    ? subscribeDeletes.filter(call => (
        subscribeGets[1].getStart() < call.getStart()
        && call.getStart() < handoffCalls[0].getStart()
      ))
    : [];
  return {
    setupSets,
    setupHas,
    subscribeGets,
    subscribeClears,
    startupCall,
    bufferedCall,
    drainDeletes,
    handoffCalls,
  };
}

function hasExpectedRawHeaderBufferShapes(ingress, calls) {
  return calls.setupSets.some(call => callArgumentsMatch(call, 'state', 'block'))
    && calls.setupSets.some(isStateNullSet)
    && calls.setupHas.some(call => callArgumentsMatch(call, 'state'))
    && hasReturningHeaderBufferBranch(ingress)
    && calls.subscribeGets.length === 2
    && calls.subscribeGets.every(call => callArgumentsMatch(call, 'state'))
    && calls.subscribeClears.length === 1
    && calls.subscribeClears.some(isStateNullSet)
    && calls.drainDeletes.length === 1
    && callArgumentsMatch(calls.drainDeletes[0], 'state')
    && calls.handoffCalls.length === 1
    && callArgumentsMatch(calls.handoffCalls[0], null, 'deferred')
    && Boolean(calls.startupCall)
    && Boolean(calls.bufferedCall);
}

function hasExpectedRawHeaderBufferOrder(calls) {
  return calls.startupCall.getStart() < calls.subscribeGets[0].getStart()
    && calls.subscribeGets[0].getStart() < calls.subscribeClears[0].getStart()
    && calls.subscribeClears[0].getStart() < calls.bufferedCall.getStart()
    && calls.bufferedCall.getStart() < calls.subscribeGets[1].getStart()
    && calls.subscribeGets[1].getStart() < calls.drainDeletes[0].getStart()
    && calls.drainDeletes[0].getStart() < calls.handoffCalls[0].getStart();
}

function hasBufferedRawHeaderOrdering(ingress) {
  const calls = collectRawHeaderBufferCalls(ingress);
  return hasExpectedRawHeaderBufferShapes(ingress, calls)
    && hasExpectedRawHeaderBufferOrder(calls);
}

function hasWorkerRawHeaderAdapter(worker) {
  return collectContractNodes(WORKER_PATH, worker, (node) => {
    if (!ts.isNewExpression(node)
      || expressionPath(node.expression) !== 'ElectrumSubscriptionManager') return false;
    const options = node.arguments?.[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return false;
    return options.properties.some((property) => (
      ts.isPropertyAssignment(property)
      && staticPropertyText(property.name, new Map()) === 'onHeaderObservation'
      && descendantNodes(property.initializer, (child) => (
        ts.isCallExpression(child)
        && expressionPath(child.expression) === 'networkHeaderReconciliationRuntime.observe'
      )).length === 1
    ));
  }).length === 1;
}

function hasCanonicalRawHeaderCallbackFlow(ingress) {
  const startupCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'callbacks.onHeaderObservation',
    'subscribeHeaders',
  );
  const notificationCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'callbacks.onHeaderObservation',
    'observeLiveHeader',
  );
  const allCallbackCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'callbacks.onHeaderObservation',
  );
  const directLiveCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'observeLiveHeader',
    'setupEventHandlers',
  );
  const bufferedLiveCalls = callsPath(
    RAW_HEADER_INGRESS_PATH,
    ingress,
    'observeLiveHeader',
    'subscribeHeaders',
  );
  return startupCalls.length === 1
    && notificationCalls.length === 1
    && allCallbackCalls.length === 2
    && directLiveCalls.length === 1
    && bufferedLiveCalls.length === 1
    && [...startupCalls, ...notificationCalls].every(callContainsHeaderRangeFetcher);
}

function validateRawHeaderIngressSource(root, errors) {
  const ingress = readRequired(root, RAW_HEADER_INGRESS_PATH);
  const callbackTypes = readRequired(root, RAW_HEADER_CALLBACK_TYPES_PATH);
  const worker = readRequired(root, WORKER_PATH);

  if (!hasCanonicalRawHeaderCallbackFlow(ingress)) {
    errors.push(
      'raw-header ingress must route the startup tip and notifications through one onHeaderObservation boundary with a range fetcher',
    );
  }
  if (!hasBufferedRawHeaderOrdering(ingress)) {
    errors.push(
      'raw-header ingress must coalesce notifications received during startup and drain them after the startup tip',
    );
  }
  if (/\bsetCachedBlockHeight\b/.test(stripComments(ingress))) {
    errors.push('raw-header ingress must not advance the block-height cache before reconciliation');
  }
  const legacyCallbackPattern = /\b(?:callbacks\.|this\.callbacks\.)?onNewBlock\s*(?::|\()/;
  if ([ingress, callbackTypes, worker].some(source => legacyCallbackPattern.test(stripComments(source)))) {
    errors.push('raw-header ingress must not retain the legacy onNewBlock callback');
  }
  if (!hasWorkerRawHeaderAdapter(worker)) {
    errors.push('worker must adapt onHeaderObservation directly to the reconciliation runtime');
  }
}

function validatePersistedNetworkReaders(root, errors) {
  const repositoryFile = 'server/src/repositories/walletRepository.ts';
  const repository = readRequired(root, repositoryFile);
  if (!hasBoundedRepresentedNetworkRead(repositoryFile, repository)) {
    errors.push('multi-network subscription must bound its represented-network read');
  }
  for (const [file, source, minimumCalls] of [
    [
      'server/src/worker/electrumManager/addressSubscriptions.ts',
      readRequired(root, 'server/src/worker/electrumManager/addressSubscriptions.ts'),
      2,
    ],
    [
      'server/src/worker/electrumManager/healthMonitoring.ts',
      readRequired(root, 'server/src/worker/electrumManager/healthMonitoring.ts'),
      1,
    ],
  ]) {
    if (callsPath(file, source, 'resolvePersistedBitcoinNetwork').length < minimumCalls) {
      errors.push(`${file} must use the strict persisted-network resolver`);
    }
    if (usesPersistedNetworkFallback(file, source)) {
      errors.push(`${file} must not fall back an invalid persisted network to mainnet`);
    }
  }
}

function validateMultiNetworkSubscriptionSource(root, errors) {
  const managerFile = 'server/src/worker/electrumManager/electrumManager.ts';
  const manager = readRequired(root, managerFile);
  validateManagerNetworkCalls(managerFile, manager, errors);
  validateManagerStatusCalls(managerFile, manager, errors);
  validateWorkerMultiNetworkCalls(readRequired(root, WORKER_PATH), errors);
  validatePersistedNetworkReaders(root, errors);
}

export function checkWalletSyncLifecycleContract(root) {
  const contract = parseWalletSyncLifecycleContract(readRequired(root, CONTRACT_PATH));
  const sources = collectSources(root);
  const productionSources = collectProductionSources(root);
  const errors = [];
  const admissionConsumers = unexpectedAdmissionConsumers(
    sources,
    contract.futureOwnership.singleAdmissionModule,
    contract.compatibility.generationConsumerModule,
    contract.inventory.producerCallsites,
  );
  if (admissionConsumers.length > 0) {
    errors.push(
      `durable admission consumed outside the exact producer/consumer inventory: ${admissionConsumers.join(', ')}`,
    );
  }
  const activationConsumers = unexpectedActivationConsumers(sources);
  if (activationConsumers.length > 0) {
    errors.push(
      `wallet-sync activation floor consumed before activation release: ${activationConsumers.join(', ')}`,
    );
  }
  const subscriptionConsumers = unexpectedSubscriptionBoundaryConsumers(
    sources,
    contract.futureOwnership,
  );
  if (subscriptionConsumers.length > 0) {
    errors.push(
      `subscription enrollment consumed outside its worker-owned boundary: ${subscriptionConsumers.join(', ')}`,
    );
  }
  validateRecoveryComposition(
    sources,
    contract.futureOwnership.singleAdmissionModule,
    errors,
  );
  validateReservedFullResyncQueueAuthority(
    productionSources,
    contract.futureOwnership.singleAdmissionModule,
    errors,
  );
  validateProducerCallsites(productionSources, contract.inventory, errors);
  validateRawQueueMutations(productionSources, contract.inventory, errors);
  validateForbiddenClientHistory(productionSources, contract.inventory, errors);
  validateNoTrackedProducerReexports(productionSources, errors);
  validateNoTrackedCommonJsImports(productionSources, errors);
  validateCheckpointedAddressWriters(productionSources, contract.inventory, errors);
  compareDirectCalls(productionSources, contract.inventory.directExecutorCalls, errors);
  compareReferenceInventory(
    sources,
    contract.inventory.symbolReferences,
    'symbol',
    (symbol) => new RegExp(`\\b${escapeRegExp(symbol)}\\b`),
    errors,
  );
  compareReferenceInventory(
    sources,
    contract.inventory.literalReferences,
    'literal',
    (literal) => new RegExp(escapeRegExp(literal)),
    errors,
  );
  validateDocumentation(root, contract, errors);
  validateWireSource(root, errors);
  validateRawHeaderIngressSource(root, errors);
  validateMultiNetworkSubscriptionSource(root, errors);
  return { contract, errors, scannedFiles: sources.size };
}

function runCli() {
  const root = process.env.QUALITY_ROOT ?? process.cwd();
  try {
    const result = checkWalletSyncLifecycleContract(root);
    if (result.errors.length > 0) {
      console.error('wallet-sync-lifecycle-contract: failed');
      for (const error of result.errors) console.error(`wallet-sync-lifecycle-contract: ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`wallet-sync-lifecycle-contract: passed (${result.scannedFiles} production files scanned)`);
  } catch (error) {
    console.error('wallet-sync-lifecycle-contract: failed');
    console.error(`wallet-sync-lifecycle-contract: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) runCli();

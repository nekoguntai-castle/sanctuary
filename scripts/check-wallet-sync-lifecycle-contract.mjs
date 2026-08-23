#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'claimFresh',
  'complete',
  'recover',
  'recoverExpired',
  'reclaimExpired',
  'releaseAsActionRequired',
  'releaseForRetry',
  'request',
  'wake',
];
const SYNC_INTENT_REPOSITORY_PATH = 'server/src/repositories/syncIntentRepository.ts';
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
const SUBSCRIPTION_ENROLLMENT_WRITERS = [
  'completeSubscriptionEnrollment',
  'requestSubscriptionEnrollment',
];

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
  return parsed;
}

export function parseWalletSyncLifecycleContract(source) {
  const contract = requireObject(JSON.parse(source), 'contract');
  if (contract.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (contract.deliveryState !== 'gated_bounded_recovery') {
    throw new Error('deliveryState must remain gated_bounded_recovery in this slice');
  }
  if (contract.cutoverComplete !== false) throw new Error('cutoverComplete must remain false');

  const wire = requireObject(contract.wireContract, 'wireContract');
  if (wire.currentProducerVersion !== 1 || wire.unversionedPayloadMeans !== 1) {
    throw new Error('the compatibility precursor must retain v1 producers and unversioned-v1 reads');
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

  const ownership = validateOwnership(contract.futureOwnership);
  validateCompatibility(contract.compatibility);
  assertExact(contract.requiredInvariantIds, REQUIRED_INVARIANTS, 'requiredInvariantIds');
  const inventory = validateInventory(contract.inventory);
  validateSubscriptionInventory(inventory, ownership);
  return contract;
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
    throw new Error('futureOwnership.subscriptionEnrollmentCoordinator must name the dormant coordinator');
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
  if (compatibility.admissionState !== 'gate_enforced_consumer_and_recovery_no_request_producers') {
    throw new Error('admission must remain gate-enforced without request producers');
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
  if (compatibility.subscriptionEnrollmentState !== 'dormant_no_production_consumers') {
    throw new Error('subscription enrollment must remain dormant before its activation release');
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
  for (const writer of SUBSCRIPTION_ENROLLMENT_WRITERS) {
    const expected = [REPOSITORY_BARREL_PATH, repository];
    if (writer === 'completeSubscriptionEnrollment') expected.push(coordinator);
    assertExact(
      subscriptionSymbolEntries(inventory, writer),
      expected.sort(),
      `subscription enrollment writer ${writer}`,
    );
  }
  assertExact(
    subscriptionSymbolEntries(inventory, SUBSCRIPTION_ENROLLMENT_COORDINATOR_SYMBOL),
    [coordinator],
    'subscription enrollment coordinator references',
  );
}

function unexpectedSubscriptionBoundaryConsumers(sources, ownership) {
  const repository = ownership.subscriptionCheckpointRepository;
  const coordinator = ownership.subscriptionEnrollmentCoordinator;
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
  const allowedWriters = new Set([repository, coordinator]);
  return [...new Set([
    ...writerConsumers.filter(file => !allowedWriters.has(file)),
    ...coordinatorConsumers.filter(file => file !== coordinator),
  ])].sort();
}

function unexpectedAdmissionConsumers(
  sources,
  admissionModule,
  generationConsumerModule,
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
  const allowedModuleConsumers = new Set([
    admissionModule,
    generationConsumerModule,
    RECOVERY_COORDINATOR_PATH,
    RECOVERY_RUNTIME_PATH,
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
    [RECOVERY_RUNTIME_PATH, new Set(['recover', 'recoverExpired'])],
  ]);
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
      /if\s*\(\s*!\s*await\s+authorize\(\)\s*\)\s*return\s*\{\s*status\s*:\s*['"]blocked['"]\s*\}[\s\S]{0,240}await\s+enqueueReservedFullResyncWakeup\s*\(/,
      'reserved full-resync recovery wake-ups must recheck activation inline',
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
  const wakeupAliases = ['enqueueReservedFullResyncWakeup'];
  const destructuredAliases = runtime.matchAll(
    /\b(?:const|let|var)\s*\{[^}]*\benqueueReservedFullResyncWakeup\s*:\s*([A-Za-z_$][\w$]*)[^}]*\}\s*=/g,
  );
  for (const match of destructuredAliases) wakeupAliases.push(match[1]);
  for (let index = 0; index < wakeupAliases.length; index += 1) {
    const alias = wakeupAliases[index];
    const sourceExpression = `(?:${escapeRegExp(alias)}\\b|[A-Za-z_$][\\w$]*\\s*(?:\\.\\s*${escapeRegExp(alias)}\\b|\\[\\s*['"]${escapeRegExp(alias)}['"]\\s*\\]))`;
    const assignments = new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${sourceExpression}`,
      'g',
    );
    for (const match of runtime.matchAll(assignments)) {
      if (!wakeupAliases.includes(match[1])) wakeupAliases.push(match[1]);
    }
  }
  const reservedWakeupCalls = wakeupAliases.reduce(
    (count, alias) => count + countMatches(
      runtime,
      new RegExp(
        `(?:\\b${escapeRegExp(alias)}\\s*\\(|\\[\\s*['"]${escapeRegExp(alias)}['"]\\s*\\]\\s*\\()`,
        'g',
      ),
    ),
    0,
  );
  if (reservedWakeupCalls !== 1) {
    errors.push('recovery runtime must contain exactly one guarded reserved full-resync enqueue');
  }
  if (countMatches(runtime, /\bcreateSyncIntentRecoveryCoordinator\s*\(/g) !== 1) {
    errors.push('recovery runtime must construct exactly one bounded coordinator');
  }
  if (!/inspectActivation\s*:\s*\(\)\s*=>\s*walletSyncActivationGate\.inspect\s*\(\)/.test(admission)) {
    errors.push('canonical admission must inspect the activation gate');
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

function countLowLevelCalls(source, callee) {
  let count = 0;
  const imports = /\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;
  for (const match of source.matchAll(imports)) {
    if (!/\/bitcoin\/blockchain(?:\/[^'"]+)?$/.test(match[2])) continue;
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(match[1])?.[1];
    if (namespace) {
      count += countMatches(
        source,
        new RegExp(`\\b${escapeRegExp(namespace)}\\.${escapeRegExp(callee)}\\s*\\(`, 'g'),
      );
    }
    for (const alias of namedImportAliases(match[1], callee)) {
      count += countMatches(source, new RegExp(`\\b${escapeRegExp(alias)}\\s*\\(`, 'g'));
    }
  }
  return count;
}

function compareDirectCalls(sources, definitions, errors) {
  for (const definition of definitions) {
    const excluded = new Set(definition.implementationModules);
    const actual = [];
    for (const [file, source] of sources) {
      if (excluded.has(file)) continue;
      const count = countLowLevelCalls(source, definition.callee);
      if (count > 0) actual.push({ file, count });
    }
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
    errors.push('sync job producers must remain on wire version 1');
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

export function checkWalletSyncLifecycleContract(root) {
  const contract = parseWalletSyncLifecycleContract(readRequired(root, CONTRACT_PATH));
  const sources = collectSources(root);
  const errors = [];
  const admissionConsumers = unexpectedAdmissionConsumers(
    sources,
    contract.futureOwnership.singleAdmissionModule,
    contract.compatibility.generationConsumerModule,
  );
  if (admissionConsumers.length > 0) {
    errors.push(
      `durable admission producer activated before cutover: ${admissionConsumers.join(', ')}`,
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
      `subscription enrollment activated outside its dormant boundary: ${subscriptionConsumers.join(', ')}`,
    );
  }
  validateRecoveryComposition(
    sources,
    contract.futureOwnership.singleAdmissionModule,
    errors,
  );
  compareDirectCalls(sources, contract.inventory.directExecutorCalls, errors);
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

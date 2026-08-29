#!/usr/bin/env node
'use strict';
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { readdir } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const IMAGE_ROOT = resolve(process.env.SANCTUARY_REPLAY_IMAGE_ROOT || '/app');
const COMPILED_ROOT = resolve(IMAGE_ROOT, 'dist/server/src');
const fixturePath = resolve(process.env.SANCTUARY_REPLAY_FIXTURE || '/replay/wallet-sync-persistence-fixture.cjs');
const manifestPath = resolve(process.env.SANCTUARY_REPLAY_MANIFEST || '/replay/wallet-sync-persistence-manifest.json');
const helperPath = resolve(process.env.SANCTUARY_REPLAY_DRIVER_HELPERS || '/replay/wallet-sync-persistence-driver-helpers.cjs');
const role = process.env.SANCTUARY_REPLAY_ROLE || 'rc11';
const mode = process.env.SANCTUARY_REPLAY_MODE || 'live';
const imageRequire = createRequire(resolve(IMAGE_ROOT, 'package.json'));
const bitcoin = imageRequire('bitcoinjs-lib');
const { buildFixture, canonicalJson, sha256 } = require(fixturePath);
const { createDriverHelpers } = require(helperPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const absoluteModule = relative => require(resolve(COMPILED_ROOT, relative));
const trace = [];
let activeMutation;
let activePass = 0;
let injectedPersistenceFault;
let stagedMaxFixtureBytes = 0;
function emit(event, details = {}) {
  const record = { event, at: new Date().toISOString(), role, mode, ...details };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  return record;
}
function cgroupBytes(counter) {
  const value = readFileSync(`/sys/fs/cgroup/${counter}`, 'utf8').trim();
  if (!/^\d+$/.test(value)) throw new Error(`Required cgroup counter ${counter} is unavailable`);
  return Number(value);
}
function emitResourceCheckpoint(stage, details = {}) {
  emit('resource_checkpoint', {
    pass: activePass,
    stage,
    currentBytes: cgroupBytes('memory.current'),
    kernelPeakBytes: cgroupBytes('memory.peak'),
    ...details,
  });
}

function instrumentProductionModules() {
  const mutationModule = absoluteModule('services/bitcoin/sync/mutationBoundary.js');
  const originalMutation = mutationModule.runWalletSyncMutation;
  mutationModule.runWalletSyncMutation = async (ctx, unit, callback, ...rest) => {
    const entry = {
      sequence: trace.length + 1,
      pass: activePass,
      kind: 'mutation',
      unit,
      walletId: ctx.walletId,
      parentIds: [],
      txids: [],
      utxoKeys: [],
      utxoIds: [],
      draftIds: [],
      startedAt: new Date().toISOString(),
    };
    trace.push(entry);
    const previous = activeMutation;
    activeMutation = entry;
    emit('mutation_started', entry);
    try {
      const value = await originalMutation(ctx, unit, callback, ...rest);
      entry.completedAt = new Date().toISOString();
      emit('mutation_completed', entry);
      return value;
    } catch (error) {
      entry.failedAt = new Date().toISOString();
      entry.error = error instanceof Error ? error.message : String(error);
      emit('mutation_failed', entry);
      throw error;
    } finally {
      activeMutation = previous;
    }
  };

  const repositories = absoluteModule('repositories/index.js');
  const repository = repositories.transactionRepository;
  for (const name of ['persistAddressSyncIORows', 'markIoRepairAttempts', 'markClassificationRepairAttempts']) {
    const original = repository[name];
    if (typeof original !== 'function') continue;
    repository[name] = async (...args) => {
      if (activeMutation) {
        if (name === 'persistAddressSyncIORows') {
          const [inputs, outputs, completeIds] = args;
          activeMutation.parentIds.push(...new Set([
            ...(inputs || []).map(row => row.transactionId),
            ...(outputs || []).map(row => row.transactionId),
            ...(completeIds || []),
          ]));
        } else {
          activeMutation.txids.push(...(args[1] || []));
        }
      }
      if (name === 'persistAddressSyncIORows' && injectedPersistenceFault) {
        injectedPersistenceFault.calls += 1;
        if (injectedPersistenceFault.calls === injectedPersistenceFault.throwOnCall) {
          throw new Error('replay_injected_middle_chunk_failure');
        }
      }
      return original(...args);
    };
  }
  for (const name of [
    'findPendingWithSharedInputs',
    'batchUpdateRbfStatus',
    'reconcilePendingRbfForConfirmedTransactions',
  ]) {
    const original = repository[name];
    if (typeof original !== 'function') continue;
    repository[name] = async (...args) => {
      if (activeMutation) activeMutation.rbfCalls = (activeMutation.rbfCalls || 0) + 1;
      return original(...args);
    };
  }
  const utxoRepository = repositories.utxoRepository;
  for (const name of ['createMany', 'batchUpdateByIds', 'markManyAsSpent']) {
    const original = utxoRepository[name];
    if (typeof original !== 'function') continue;
    utxoRepository[name] = async (...args) => {
      if (activeMutation) {
        if (name === 'createMany') {
          activeMutation.utxoKeys.push(...(args[0] || []).map(row => `${row.txid}:${row.vout}`));
        } else if (name === 'batchUpdateByIds') {
          activeMutation.utxoIds.push(...(args[0] || []).map(row => row.id));
        } else activeMutation.utxoIds.push(...(args[0] || []));
      }
      return original(...args);
    };
  }
  const draftRepository = repositories.draftRepository;
  if (typeof draftRepository.deleteManyByIds === 'function') {
    const originalDeleteDrafts = draftRepository.deleteManyByIds;
    draftRepository.deleteManyByIds = async (...args) => {
      if (activeMutation) activeMutation.draftIds.push(...(args[0] || []));
      return originalDeleteDrafts(...args);
    };
  }
}

instrumentProductionModules();
const sync = absoluteModule('services/bitcoin/sync/index.js');
const evidenceAuthentication = absoluteModule('services/bitcoin/sync/evidenceAuthentication.js');
const evidenceProjection = absoluteModule('services/bitcoin/sync/transactionEvidenceProjection.js');
const prismaModule = absoluteModule('models/prisma.js');
const prisma = prismaModule.default;
const { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } = absoluteModule('constants/transactionClassification.js');
const { startHealthServer } = absoluteModule('worker/healthServer.js');
const {
  assertPreStartUtxos,
  assertSealedUtxoReceipt,
  createArchitectureCollector,
  databaseReceipt,
  seedDatabase,
} = createDriverHelpers({
  bitcoin,
  canonicalJson,
  classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
  emit,
  emitResourceCheckpoint,
  prisma,
  sha256,
});

function assertManifest(fixture) {
  const builderDigest = sha256(readFileSync(fixturePath));
  const helperDigest = sha256(readFileSync(helperPath));
  const errors = [
    builderDigest !== manifest.fixtureBuilderSha256 && `fixture builder ${builderDigest}`,
    helperDigest !== manifest.driverHelperSha256 && `driver helper ${helperDigest}`,
    fixture.definitionDigest !== manifest.fixtureDefinitionSha256 && `fixture definition ${fixture.definitionDigest}`,
    fixture.firstPageDigest !== manifest.firstPageUnionSha256 && `first-page union ${fixture.firstPageDigest}`,
    fixture.firstPageUnion.txids.length !== manifest.firstPage.transactions && 'first-page transaction count',
    fixture.firstPageUnion.inputs !== manifest.firstPage.inputs && 'first-page input union',
    fixture.firstPageUnion.outputs !== manifest.firstPage.outputs && 'first-page output union',
    [...fixture.validUtxos.values()].reduce((sum, rows) => sum + rows.length, 0) !== manifest.finalReceipt.validUtxos && 'valid UTXO count',
    fixture.negativeListings.length !== manifest.finalReceipt.rejectedUtxoListings && 'negative UTXO listing count',
    fixture.negativeUtxoSentinels.length + manifest.finalReceipt.validUtxos !== manifest.finalReceipt.utxos && 'final UTXO count',
  ].filter(Boolean);
  if (errors.length) throw new Error(`Sealed replay fixture mismatch: ${errors.join('; ')}`);
  emit('fixture_verified', {
    fixtureBuilderSha256: builderDigest,
    driverHelperSha256: helperDigest,
    fixtureDefinitionSha256: fixture.definitionDigest,
    firstPageUnionSha256: fixture.firstPageDigest,
    firstPage: manifest.firstPage,
  });
}

function clientFor(fixture, batches) {
  return {
    getAddressHistoryBatch: async addresses => {
      batches.history.push(addresses.length);
      return new Map(addresses.map(address => [address, fixture.histories.get(address) || []]));
    },
    getAddressHistory: async address => fixture.histories.get(address) || [],
    getAddressUTXOsBatch: async addresses => new Map(addresses.map(address => [address, fixture.utxos.get(address) || []])),
    getAddressUTXOs: async address => fixture.utxos.get(address) || [],
    getTransactionsBatch: async txids => {
      batches.unauthenticatedFallbacks += 1;
      return new Map(txids.flatMap(txid => {
      const details = fixture.rawTransactions.get(txid);
      return details ? [[txid, details]] : [];
      }));
    },
    getTransaction: async txid => {
      batches.unauthenticatedFallbacks += 1;
      return fixture.rawTransactions.get(txid);
    },
    getRawTransactionEvidenceBatch: async txids => {
      batches.raw.push(txids.length);
      return new Map(txids.flatMap(txid => {
        const details = fixture.rawTransactions.get(txid);
        return details ? [[txid, details]] : [];
      }));
    },
  };
}

function contextFor(fixture, deadlineAt, signal = new AbortController().signal) {
  const batches = { history: [], raw: [], unauthenticatedFallbacks: 0 };
  const architecture = createArchitectureCollector(fixture);
  const addresses = fixture.addresses;
  return {
    context: sync.createTestContext({
      walletId: fixture.definition.walletId,
      wallet: { id: fixture.definition.walletId, network: fixture.definition.network },
      network: fixture.definition.network,
      client: clientFor(fixture, batches),
      addresses,
      walletAddressSet: new Set(addresses.map(address => address.address)),
      addressMap: new Map(addresses.map(address => [address.address, address])),
      addressToDerivationPath: new Map(addresses.map(address => [address.address, address.derivationPath || ''])),
      walletScriptToAddress: new Map(addresses.map(address => [address.scriptPubKey.toLowerCase(), address])),
      attemptRuntime: { signal, deadlineAt },
      mutationFence: {
        walletId: fixture.definition.walletId,
        generation: fixture.definition.leaseGeneration,
        leaseToken: fixture.definition.leaseToken,
      },
      evidenceObserver: event => architecture.observe(event),
    }),
    batches,
    architecture,
  };
}

function assertBatchContract(batches, rawEvidenceExpected) {
  for (const [name, values] of [['history', batches.history], ['raw', batches.raw]]) {
    if ((!rawEvidenceExpected && name === 'raw' && values.length === 0)) continue;
    if (values.length === 0 || values.some(size => size < 1 || size > 10)) {
      throw new Error(`Unexpected ${name} batch shape: ${values.join(',')}`);
    }
  }
  if (role === 'rc11' && batches.unauthenticatedFallbacks !== 0) {
    throw new Error(`Unauthenticated raw fallback called ${batches.unauthenticatedFallbacks} times`);
  }
}

function sealUtxoEvidenceReceipt(fixture, context, batches, pass) {
  const expected = new Set([...fixture.validUtxos.values()].flatMap(rows => rows.map(
    row => `${row.tx_hash}:${row.tx_pos}`,
  )));
  const actual = [...context.allUtxoKeys].sort();
  if (actual.length !== expected.size || actual.some(key => !expected.has(key))) {
    throw new Error('Authenticated UTXO evidence set did not match the 47 valid listings');
  }
  const negativeKeys = new Set(fixture.negativeListings.map(
    row => `${row.txid}:${row.vout}`,
  ));
  if (actual.some(key => negativeKeys.has(key)) || batches.unauthenticatedFallbacks !== 0) {
    throw new Error('Negative UTXO evidence or unauthenticated fallback entered the accepted set');
  }
  const reasons = Object.fromEntries([...context.rejectedEvidenceReasons].sort());
  for (const reason of ['amount_mismatch', 'script_mismatch', 'missing_output', 'txid_mismatch']) {
    if (!(reasons[reason] > 0)) throw new Error(`UTXO replay did not exercise ${reason}`);
  }
  const receipt = {
    pass,
    acceptedCount: actual.length,
    acceptedOutpointDigest: sha256(canonicalJson(actual)),
    rejectedListingCount: fixture.negativeListings.length,
    omissionSentinelCount: 1,
    unauthenticatedFallbackCount: batches.unauthenticatedFallbacks,
    rejectedEvidenceReasons: reasons,
  };
  emit('utxo_evidence_receipt', receipt);
  return receipt;
}

function assertProductionEvidenceReleased(context, pass) {
  const receipt = {
    pass,
    txDetailsCacheSize: context.txDetailsCache.size,
    compactEvidenceSize: context.authenticatedTransactionEvidence.size,
    outpointEvidenceSize: context.authenticatedOutpointEvidence.size,
    outpointCoverageSize: context.authenticatedOutpointCoverage.size,
    spentOutpointSize: context.authenticatedSpentOutpointKeys.size,
  };
  if (Object.entries(receipt).some(([key, value]) => key !== 'pass' && value !== 0)) {
    throw new Error(`Production evidence cleanup was incomplete in pass ${pass}`);
  }
  emit('production_evidence_release_receipt', receipt);
  return receipt;
}

async function runMeasuredPhase(context, pass, stage, phase, timeoutMs) {
  const startedAt = Date.now();
  let budgetExceeded = false;
  emit('phase_started', { pass, stage });
  emitResourceCheckpoint(`before_${stage}`);
  try {
    await phase(context);
    const elapsedMs = Date.now() - startedAt;
    if (stage === 'fetchHistories' && elapsedMs > manifest.limits.addressHistoryMs) {
      budgetExceeded = true;
      emit('phase_budget_exceeded', {
        pass, stage, elapsedMs, limitMs: manifest.limits.addressHistoryMs,
      });
      throw new Error(`Pass ${pass} address history exceeded ${manifest.limits.addressHistoryMs}ms`);
    }
    trace.push({ sequence: trace.length + 1, pass, kind: 'phase', stage });
    emitResourceCheckpoint(`after_${stage}`);
    emit('phase_completed', { pass, stage, elapsedMs });
  } catch (error) {
    if (!budgetExceeded) {
      emit('phase_failed', {
        pass,
        stage,
        elapsedMs: Date.now() - startedAt,
        limitMs: stage === 'fetchHistories' ? manifest.limits.addressHistoryMs : timeoutMs,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    throw error;
  }
}

function assertCursorTrace(pass, passTrace, selectedTxids) {
  const mutations = passTrace.filter(entry => (
    entry.kind === 'mutation' && entry.unit === 'repair_attempt_cursors'
  ));
  if (mutations.some(entry => new Set(entry.txids).size > 25)) {
    throw new Error(`Pass ${pass} cursor mutation exceeded the 25-candidate page`);
  }
  const cursorTxids = new Set(mutations.flatMap(entry => entry.txids));
  if (cursorTxids.size !== selectedTxids.length
    || selectedTxids.some(txid => !cursorTxids.has(txid))) {
    throw new Error(`Pass ${pass} cursor trace did not match its deterministic candidate page`);
  }
}

function releasePassContext(context, pass) {
  context.historyResults.clear();
  context.existingTxMap.clear();
  context.existingTxidSet.clear();
  context.classificationRepairTxids.clear();
  context.ioRepairTxids.clear();
  context.utxoDataMap.clear();
  context.allTxids.clear();
  context.allUtxoKeys.clear();
  context.newTransactions.length = 0;
  context.utxoResults.length = 0;
  if (typeof global.gc === 'function') global.gc();
  emitResourceCheckpoint('pass_context_released');
  emit('pass_context_released', { pass, rssBytes: process.memoryUsage().rss });
}

async function executePass(fixture, pass) {
  activePass = pass;
  const passTraceStart = trace.length;
  const timeoutMs = pass === 3 ? manifest.limits.noopPassMs : manifest.limits.passMs;
  const signal = AbortSignal.timeout(timeoutMs);
  const { context, batches, architecture } = contextFor(fixture, Date.now() + timeoutMs, signal);
  const startedAt = Date.now();
  for (const [stage, phase] of [
    ['fetchHistories', sync.fetchHistoriesPhase],
    ['checkExisting', sync.checkExistingPhase],
    ['processTransactions', sync.processTransactionsPhase],
    ['fetchUtxos', sync.fetchUtxosPhase],
    ['reconcileUtxos', sync.reconcileUtxosPhase],
    ['insertUtxos', sync.insertUtxosPhase],
  ]) {
    await runMeasuredPhase(context, pass, stage, phase, timeoutMs);
  }
  const evidenceReleaseReceipt = role === 'rc11'
    ? assertProductionEvidenceReleased(context, pass)
    : undefined;
  assertBatchContract(batches, context.newTxids.length > 0);
  const utxoEvidenceReceipt = role === 'rc11'
    ? sealUtxoEvidenceReceipt(fixture, context, batches, pass)
    : undefined;
  const passTrace = trace.slice(passTraceStart);
  const persistence = passTrace.filter(entry => entry.kind === 'mutation' && entry.unit === 'transaction_batch');
  const selectedTxids = [...context.newTxids];
  const architectureReceipt = role === 'rc11'
    ? architecture.receipt(new Set(selectedTxids))
    : undefined;
  assertCursorTrace(pass, passTrace, selectedTxids);
  if (architectureReceipt) emit('architecture_receipt', { pass, ...architectureReceipt });
  emit('pass_trace', { pass, selectedTxids, batches, persistence, trace: passTrace });
  releasePassContext(context, pass);
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > timeoutMs) throw new Error(`Pass ${pass} exceeded ${timeoutMs}ms`);
  return {
    selectedTxids, elapsedMs, passTrace, persistence,
    architectureReceipt, utxoEvidenceReceipt, evidenceReleaseReceipt,
  };
}

function assertOneParentMutations(passResult) {
  for (const mutation of passResult.persistence) {
    const parentIds = [...new Set(mutation.parentIds)];
    if (parentIds.length !== 1) throw new Error(`Persistence mutation ${mutation.sequence} owned ${parentIds.length} parents`);
  }
}

function assertUtxoMutationSet(fixture, passResult, shouldWrite) {
  const mutations = passResult.passTrace.filter(entry => entry.kind === 'mutation'
    && ['utxo_reconciliation', 'utxo_insert'].includes(entry.unit));
  if (!shouldWrite) {
    if (mutations.length !== 0) throw new Error('No-op UTXO pass performed a mutation');
    return;
  }
  const expectedKeys = new Set([...fixture.validUtxos.values()].flatMap(rows => rows.map(
    row => `${row.tx_hash}:${row.tx_pos}`,
  )));
  const inserted = new Set(mutations.flatMap(entry => entry.utxoKeys));
  inserted.add(`${fixture.seededValidUtxo.txid}:${fixture.seededValidUtxo.vout}`);
  if (inserted.size !== expectedKeys.size || [...expectedKeys].some(key => !inserted.has(key))) {
    throw new Error('UTXO insert/update mutation set did not match all valid listings');
  }
  if (!mutations.some(entry => entry.unit === 'utxo_reconciliation'
      && entry.utxoIds.includes(fixture.seededValidUtxo.id))
    || !mutations.some(entry => entry.unit === 'utxo_insert')) {
    throw new Error('UTXO reconciliation/insert mutation identities were not both observed');
  }
  const forbiddenIds = new Set(fixture.negativeUtxoSentinels.map(row => row.id));
  if (mutations.some(entry => entry.utxoIds.some(id => forbiddenIds.has(id)) || entry.draftIds.length > 0)) {
    throw new Error('Negative UTXO or draft state reached persistence');
  }
}

function assertSeededOutputs(fixture, receipt) {
  const expected = [...fixture.definition.seededOutputs].sort((left, right) => left.id.localeCompare(right.id));
  if (receipt.seeded.length !== expected.length || expected.some((seed, index) => (
    receipt.seeded[index]?.id !== seed.id
    || receipt.seeded[index]?.label !== seed.label
    || receipt.seeded[index]?.transactionId !== `replay-transaction-${seed.transactionIndex}`
  ))) throw new Error('Seeded output identity/label preservation failed');
}

async function runLive(fixture, baselineThreads) {
  await seedDatabase(fixture);
  const sealed = await databaseReceipt(fixture, 'pre_start_receipt', 0);
  if (sealed.transactions !== 169 || sealed.inputs !== 0 || sealed.outputs !== 2 || sealed.complete !== 0) {
    throw new Error('Pre-start database receipt does not match the sealed fixture');
  }
  assertPreStartUtxos(fixture, sealed);
  assertSeededOutputs(fixture, sealed);
  const sealedLifecycleDigest = sealed.walletLifecycleDigest;
  const originalCursorTimes = new Map(sealed.cursors.map(row => [row.txid, row.ioLastAttemptAt?.toISOString()]));
  emit('replay_ready', { rssBytes: process.memoryUsage().rss, firstPageUnionSha256: fixture.firstPageDigest });
  await new Promise(resolvePromise => process.once('SIGUSR2', resolvePromise));
  const passOne = await executePass(fixture, 1);
  if (passOne.selectedTxids.length !== 100) throw new Error(`Pass one selected ${passOne.selectedTxids.length}`);
  const expectedFirstPage = new Set(fixture.firstPageUnion.txids);
  if (passOne.selectedTxids.some(txid => !expectedFirstPage.has(txid))
    || expectedFirstPage.size !== new Set(passOne.selectedTxids).size) {
    throw new Error('Pass one selection does not match the pre-sealed deterministic txid set');
  }
  if (role === 'rc11') assertOneParentMutations(passOne);
  if (role === 'rc11') assertUtxoMutationSet(fixture, passOne, true);
  const receiptOne = await databaseReceipt(fixture, 'pass_completed', 1);
  assertSeededOutputs(fixture, receiptOne);
  if (receiptOne.walletLifecycleDigest !== sealedLifecycleDigest) throw new Error('Pass one mutated wallet lifecycle state');
  if (receiptOne.complete !== 100 || receiptOne.incomplete !== 69
    || receiptOne.inputs !== manifest.firstPage.inputs || receiptOne.outputs !== manifest.firstPage.outputs) {
    throw new Error('Pass-one database receipt mismatch');
  }
  assertSealedUtxoReceipt(fixture, receiptOne, 1);
  const selected = new Set(passOne.selectedTxids);
  for (const cursor of receiptOne.cursors) {
    const now = cursor.ioLastAttemptAt?.toISOString();
    const before = originalCursorTimes.get(cursor.txid);
    if (selected.has(cursor.txid) ? now === before : now !== before) {
      throw new Error(`Pass-one cursor mutation mismatch for ${cursor.txid}`);
    }
  }
  const passTwo = await executePass(fixture, 2);
  if (passTwo.selectedTxids.length !== 69) throw new Error(`Pass two selected ${passTwo.selectedTxids.length}`);
  if (role === 'rc11') assertOneParentMutations(passTwo);
  if (role === 'rc11') assertUtxoMutationSet(fixture, passTwo, false);
  const receiptTwo = await databaseReceipt(fixture, 'pass_completed', 2);
  assertSeededOutputs(fixture, receiptTwo);
  if (receiptTwo.walletLifecycleDigest !== sealedLifecycleDigest) throw new Error('Pass two mutated wallet lifecycle state');
  if (receiptTwo.complete !== manifest.finalReceipt.complete
    || receiptTwo.transactions !== manifest.finalReceipt.transactions
    || receiptTwo.inputs !== manifest.finalReceipt.inputs || receiptTwo.outputs !== manifest.finalReceipt.outputs) {
    throw new Error('Pass-two database receipt mismatch');
  }
  assertSealedUtxoReceipt(fixture, receiptTwo, 2);
  const passThree = await executePass(fixture, 3);
  if (passThree.selectedTxids.length !== 0) throw new Error(`Pass three selected ${passThree.selectedTxids.length}`);
  const forbiddenNoopWrites = passThree.passTrace.filter(entry => entry.kind === 'mutation');
  if (forbiddenNoopWrites.length) throw new Error(`No-op pass made ${forbiddenNoopWrites.length} persistence mutations`);
  if (role === 'rc11') assertUtxoMutationSet(fixture, passThree, false);
  const receiptThree = await databaseReceipt(fixture, 'pass_completed', 3);
  assertSeededOutputs(fixture, receiptThree);
  assertSealedUtxoReceipt(fixture, receiptThree, 3);
  if (receiptThree.walletLifecycleDigest !== sealedLifecycleDigest) throw new Error('Pass three mutated wallet lifecycle state');
  for (const key of ['transactions', 'complete', 'inputs', 'outputs', 'cursorDigest', 'transactionEvidenceDigest', 'inputDigest', 'outputDigest', 'utxoDigest', 'draftDigest', 'balanceMarkers']) {
    if (receiptThree[key] !== receiptTwo[key]) throw new Error(`No-op pass changed ${key}`);
  }
  emit('replay_completed', {
    passElapsedMs: [passOne.elapsedMs, passTwo.elapsedMs, passThree.elapsedMs],
    traceSha256: sha256(canonicalJson(trace)),
    mutationCount: trace.filter(entry => entry.kind === 'mutation').length,
    rssBytes: process.memoryUsage().rss,
  });
  fixture.rawTransactions.clear();
  fixture.histories.clear();
  fixture.utxos.clear();
  fixture.transactions.length = 0;
  fixture.previousTransactions.length = 0;
  if (typeof global.gc === 'function') global.gc();
  emitResourceCheckpoint('fixture_projector_cleanup');
  emit('replay_cleanup_completed', {
    rssBytes: process.memoryUsage().rss,
    threads: (await readdir('/proc/self/task')).length,
    baselineThreads,
  });
  await new Promise(resolvePromise => process.once('SIGHUP', resolvePromise));
}

function rawDetails(transaction) {
  return { txid: transaction.getId(), hex: transaction.toHex(), vin: [], vout: [] };
}

function buildMaxTransaction(externalScript, ownedScript, previous, outputCount, scriptBytes = 0) {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  if (previous.length === 0) {
    transaction.ins = [{
      hash: new Uint8Array(32), index: 0xffffffff, script: Buffer.from([1, 1]),
      sequence: 0xffffffff, witness: [],
    }];
  } else {
    transaction.ins = previous.map((details, index) => ({
      hash: Buffer.from(details.txid, 'hex').reverse(), index: details.vout ?? 0,
      script: index === 0 && scriptBytes > 0 ? Buffer.alloc(scriptBytes) : new Uint8Array(),
      sequence: 0xffffffff, witness: [],
    }));
  }
  transaction.outs = [
    ...Array.from({ length: outputCount - 1 }, () => ({ script: externalScript, value: 1n })),
    { script: ownedScript, value: 1n },
  ];
  return rawDetails(transaction);
}

function buildMaxFixture(axis, walletOrdinal, scriptBytes = 0, countOverride, includePreviousEvidence = true) {
  const addressItem = (() => {
    const hash = Buffer.alloc(20);
    hash.writeUInt32BE(9000 + walletOrdinal, 16);
    const payment = bitcoin.payments.p2wpkh({ hash, network: bitcoin.networks.bitcoin });
    if (!payment.address || !payment.output) throw new Error('Could not build max-shape address');
    return { address: payment.address, script: payment.output };
  })();
  const externalScript = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0xee), network: bitcoin.networks.bitcoin }).output;
  if (!externalScript) throw new Error('Could not build max-shape external script');
  const inputCount = axis === 'input' ? (countOverride ?? 24389) : 0;
  const outputCount = axis === 'output' ? (countOverride ?? 25000) : 1;
  const previous = inputCount > 0 && includePreviousEvidence ? (() => {
    const parent = new bitcoin.Transaction();
    parent.version = 2;
    parent.locktime = walletOrdinal;
    parent.ins = [{ hash: new Uint8Array(32), index: 0xffffffff,
      script: Buffer.from([1, walletOrdinal & 0xff]), sequence: 0xffffffff, witness: [] }];
    parent.outs = Array.from({ length: inputCount }, () => ({ script: addressItem.script, value: 1n }));
    return [rawDetails(parent)];
  })() : [];
  const inputReferences = includePreviousEvidence
    ? Array.from({ length: inputCount }, (_, vout) => ({ txid: previous[0].txid, vout }))
    : Array.from({ length: inputCount }, () => ({ txid: '11'.repeat(32) }));
  const details = buildMaxTransaction(externalScript, addressItem.script, inputReferences, outputCount, scriptBytes);
  const walletId = `00000000-0000-4000-8000-${String(100000000000 + walletOrdinal).slice(-12)}`;
  const leaseToken = `00000000-0000-4000-8001-${String(100000000000 + walletOrdinal).slice(-12)}`;
  const address = {
    id: `max-address-${walletOrdinal}`, walletId, address: addressItem.address,
    derivationPath: "m/84'/0'/0'/0/0", index: 0, branch: 0, coordinateVersion: 1,
    canonicalPolicyId: 'single_sig_native_segwit', canonicalPolicyVersion: 1,
    scriptPubKey: Buffer.from(addressItem.script).toString('hex'), used: false, createdAt: new Date(0),
  };
  return {
    definition: { walletId, leaseToken, leaseGeneration: 1, network: 'mainnet', addressCount: 1, seededOutputs: [] },
    addresses: [address],
    histories: new Map([[address.address, [{ tx_hash: details.txid, height: 800000 }]]]),
    transactions: [{ addressIndex: 0, outputCount, details }],
    rawTransactions: new Map([[details.txid, details], ...previous.map(parent => [parent.txid, parent])]),
    previousTransactions: previous,
    utxos: new Map([[address.address, [{ tx_hash: details.txid, tx_pos: outputCount - 1, value: 1, height: 800000 }]]]),
    weight: bitcoin.Transaction.fromHex(details.hex).weight(),
    inputCount,
    outputCount,
  };
}

function persistPreparedMaxFixture(label, fixture) {
  const path = `/tmp/sanctuary-replay-${label}.json`;
  const { rawTransactions: _rawTransactions, ...fixtureWithoutRawMap } = fixture;
  const serializable = {
    ...fixtureWithoutRawMap,
    addresses: fixture.addresses.map(address => ({ ...address, createdAt: address.createdAt.toISOString() })),
    histories: [...fixture.histories],
    utxos: [...fixture.utxos],
  };
  const bytes = JSON.stringify(serializable);
  const byteLength = Buffer.byteLength(bytes);
  if (stagedMaxFixtureBytes + byteLength > manifest.limits.maxFixtureStageBytes) {
    throw new Error('Prepared max fixtures exceed the sealed staging budget');
  }
  writeFileSync(path, bytes, { mode: 0o600 });
  stagedMaxFixtureBytes += byteLength;
  emit('max_fixture_sealed', { label, sha256: sha256(bytes), bytes: byteLength, stagedMaxFixtureBytes });
  return path;
}

function loadPreparedMaxFixture(path) {
  const bytes = readFileSync(path, 'utf8');
  const parsed = JSON.parse(bytes);
  unlinkSync(path);
  stagedMaxFixtureBytes -= Buffer.byteLength(bytes);
  const rawTransactions = new Map([
    ...parsed.transactions.map(item => [item.details.txid, item.details]),
    ...parsed.previousTransactions.map(item => [item.txid, item]),
  ]);
  return {
    ...parsed,
    addresses: parsed.addresses.map(address => ({ ...address, createdAt: new Date(address.createdAt) })),
    histories: new Map(parsed.histories),
    rawTransactions,
    utxos: new Map(parsed.utxos),
  };
}

function prepareMaxFixture(label, ...args) {
  let fixture = buildMaxFixture(...args);
  const path = persistPreparedMaxFixture(label, fixture);
  fixture = undefined;
  if (typeof global.gc === 'function') global.gc();
  return path;
}

async function seedMaxFixture(fixture) {
  const { walletId, leaseToken } = fixture.definition;
  await prisma.wallet.create({ data: {
    id: walletId, name: 'Maximum shape replay', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet',
    syncInProgress: true, syncExecutionOwner: 'worker', requestedIncrementalSyncGeneration: 1,
    claimedIncrementalSyncGeneration: 1, incrementalSyncLeaseToken: leaseToken,
    incrementalSyncClaimedAt: new Date(), incrementalSyncLeaseExpiresAt: new Date(Date.now() + 2 * 60 * 60_000),
  }});
  const address = fixture.addresses[0];
  await prisma.address.create({ data: {
    id: address.id, walletId: address.walletId, address: address.address,
    derivationPath: address.derivationPath, index: address.index, used: address.used,
    createdAt: address.createdAt,
  }});
  await prisma.transaction.create({ data: {
    id: `max-transaction-${walletId.slice(-4)}`, txid: fixture.transactions[0].details.txid, walletId,
    addressId: fixture.addresses[0].id, type: fixture.inputCount > 0 ? 'consolidation' : 'received',
    classificationInputsComplete: true, classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
    classificationAddressCount: 1, classificationLastAttemptAt: new Date(0), ioComplete: false,
    ioLastAttemptAt: new Date(0), amount: 1n, fee: 0n, balanceAfter: 0n, confirmations: 1,
    blockHeight: 800000, blockTime: new Date(1700000000000), rbfStatus: 'confirmed',
  }});
}

async function maxReceipt(fixture) {
  const walletId = fixture.definition.walletId;
  const [complete, inputs, outputs] = await Promise.all([
    prisma.transaction.count({ where: { walletId, ioComplete: true } }),
    prisma.transactionInput.count({ where: { transaction: { walletId } } }),
    prisma.transactionOutput.count({ where: { transaction: { walletId } } }),
  ]);
  return { complete, inputs, outputs };
}

async function runMaxProductionPass(fixture, pass, signal = new AbortController().signal) {
  activePass = pass;
  const { context, batches, architecture } = contextFor(fixture, Date.now() + manifest.limits.maxCaseMs);
  context.attemptRuntime.signal = signal;
  const before = trace.length;
  for (const [stage, phase] of [
    ['fetchHistories', sync.fetchHistoriesPhase], ['checkExisting', sync.checkExistingPhase],
    ['processTransactions', sync.processTransactionsPhase], ['fetchUtxos', sync.fetchUtxosPhase],
    ['reconcileUtxos', sync.reconcileUtxosPhase], ['insertUtxos', sync.insertUtxosPhase],
  ]) {
    emit('phase_started', { pass, stage });
    await phase(context);
    emit('phase_completed', { pass, stage });
  }
  assertProductionEvidenceReleased(context, pass);
  const selected = [...context.newTxids];
  const caseTrace = trace.slice(before);
  const allMutations = caseTrace.filter(entry => entry.kind === 'mutation');
  const mutations = allMutations.filter(entry => entry.unit === 'transaction_batch');
  const cursorTxids = new Set(caseTrace
    .filter(entry => entry.kind === 'mutation' && entry.unit === 'repair_attempt_cursors')
    .flatMap(entry => entry.txids));
  if (cursorTxids.size > 25 || cursorTxids.size !== selected.length
    || selected.some(txid => !cursorTxids.has(txid))) throw new Error('Max case cursor trace mismatch');
  assertBatchContract(batches, selected.length > 0);
  const architectureReceipt = architecture.receipt(new Set(selected));
  emit('architecture_receipt', { pass, ...architectureReceipt });
  context.historyResults.clear();
  if (typeof global.gc === 'function') global.gc();
  return { selected, mutations, allMutations, architectureReceipt };
}

function assertMaxFixture(axis, fixture, expected) {
  if (fixture.inputCount !== expected.inputs
    || fixture.outputCount !== expected.outputs
    || fixture.weight !== expected.weight) {
    throw new Error(`${axis} accepted-axis fixture mismatch`);
  }
}

function assertMaxDatabaseReceipt(axis, receipt, expected, stage) {
  if (receipt.complete !== expected.complete
    || receipt.inputs !== expected.inputs
    || receipt.outputs !== expected.outputs) {
    throw new Error(`${axis} ${stage} receipt mismatch`);
  }
}

const runWatchedMaxPass = (label, fixture, pass) => withCaseWatchdog(
  label,
  manifest.limits.maxCaseMs,
  signal => runMaxProductionPass(fixture, pass, signal),
);

async function exerciseRollback(axis, ordinal, fixture) {
  injectedPersistenceFault = { calls: 0, throwOnCall: 2 };
  try {
    await runWatchedMaxPass(`${axis}-${ordinal}-rollback`, fixture, ordinal * 10 + 3);
    throw new Error(`${axis} middle-chunk fault unexpectedly committed`);
  } catch (error) {
    if (!(error instanceof Error)
      || !error.message.includes('replay_injected_middle_chunk_failure')) throw error;
  } finally {
    injectedPersistenceFault = undefined;
  }
}

async function exerciseAcceptedMaxAxis(axis, ordinal, expected, successPath, rollbackPath) {
  let success = loadPreparedMaxFixture(successPath);
  assertMaxFixture(axis, success, expected);
  await seedMaxFixture(success);
  const first = await runWatchedMaxPass(`${axis}-${ordinal}-success`, success, ordinal * 10 + 1);
  assertOneParentMutations({ persistence: first.mutations });
  const committed = await maxReceipt(success);
  assertMaxDatabaseReceipt(axis, committed, { ...expected, complete: 1 }, 'persistence');
  const noop = await runWatchedMaxPass(`${axis}-${ordinal}-idempotency`, success, ordinal * 10 + 2);
  if (noop.selected.length !== 0 || noop.allMutations.length !== 0) throw new Error(`${axis} idempotency pass wrote data`);
  success = undefined;
  if (typeof global.gc === 'function') global.gc();
  let rollback = loadPreparedMaxFixture(rollbackPath);
  await seedMaxFixture(rollback);
  await exerciseRollback(axis, ordinal, rollback);
  const rolledBack = await maxReceipt(rollback);
  assertMaxDatabaseReceipt(axis, rolledBack, { complete: 0, inputs: 0, outputs: 0 }, 'rollback');
  const retry = await runWatchedMaxPass(`${axis}-${ordinal}-retry`, rollback, ordinal * 10 + 4);
  assertOneParentMutations({ persistence: retry.mutations });
  const retried = await maxReceipt(rollback);
  assertMaxDatabaseReceipt(axis, retried, { ...expected, complete: 1 }, 'retry');
  emit('max_axis_completed', { axis, expected, committed, rolledBack, retried });
  rollback = undefined;
  if (typeof global.gc === 'function') global.gc();
}

async function assertRejectedBoundary(fixture, reason, signal) {
  const beforeTrace = trace.length;
  const beforeDatabase = await prisma.transaction.count();
  const { context } = contextFor(fixture, Date.now() + 120000);
  const accepted = await evidenceAuthentication.fetchAuthenticatedTransactions(
    context,
    [fixture.transactions[0].details.txid],
    { signal, deadlineAt: Date.now() + 120000 },
  );
  const rejected = context.rejectedEvidenceReasons.get('transaction_complexity_exceeded') ?? 0;
  if (accepted.size !== 0 || context.txDetailsCache.size !== 0 || rejected !== 1
    || trace.length !== beforeTrace || await prisma.transaction.count() !== beforeDatabase) {
    throw new Error(`${reason} rejection reached persistence`);
  }
  emit('max_boundary_rejected', {
    reason, inputs: fixture.inputCount, outputs: fixture.outputCount, weight: fixture.weight,
    projectedResponses: accepted.size, cacheInsertions: context.txDetailsCache.size,
    rejectedEvidence: rejected, databaseMutations: trace.length - beforeTrace,
  });
}

async function withCaseWatchdog(label, timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  let watchdogError;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([
      operationPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          watchdogError = new Error(`${label} watchdog expired`);
          controller.abort(watchdogError);
          reject(watchdogError);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error !== watchdogError) throw error;
    const stopped = await Promise.race([
      operationPromise.then(() => true, () => true),
      new Promise(resolvePromise => setTimeout(() => resolvePromise(false), 5000)),
    ]);
    if (!stopped) {
      emit('case_watchdog_unstopped', { label, timeoutMs });
      process.kill(process.pid, 'SIGTERM');
      await new Promise(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runMax(fixture, baselineThreads) {
  const acceptedCases = [
    ['output-below', 'output', 1, manifest.maxAxes.outputBelow],
    ['output-at', 'output', 2, manifest.maxAxes.outputAt],
    ['input-below', 'input', 3, manifest.maxAxes.inputBelow],
    ['input-at', 'input', 4, manifest.maxAxes.inputAt],
  ].map(([label, axis, ordinal, expected]) => {
    const count = axis === 'output' ? expected.outputs : expected.inputs;
    return {
      label, axis, ordinal, expected,
      successPath: prepareMaxFixture(`${label}-success`, axis, ordinal, expected.scriptBytes, count),
      rollbackPath: prepareMaxFixture(`${label}-rollback`, axis, ordinal + 10, expected.scriptBytes, count),
    };
  });
  const boundaryPaths = {
    belowWeight: prepareMaxFixture('weight-below', 'input', 90, 7, undefined, false),
    atWeight: prepareMaxFixture('weight-at', 'input', 91, 8, undefined, false),
    aboveWeight: prepareMaxFixture('weight-above', 'input', 92, 9, undefined, false),
    belowOutputCount: prepareMaxFixture('output-count-below', 'output', 93, 0, 24999),
    atOutputCount: prepareMaxFixture('output-count-at', 'output', 94, 0, 25000),
    aboveOutputCount: prepareMaxFixture('output-count-above', 'output', 95, 0, 25001),
    input24999: prepareMaxFixture('input-count-24999', 'input', 96, 0, 24999, false),
    input25000: prepareMaxFixture('input-count-25000', 'input', 97, 0, 25000, false),
    input25001: prepareMaxFixture('input-count-25001', 'input', 98, 0, 25001, false),
  };
  let combinedFixture = buildMaxFixture('input', 100, 0, 25000, false);
  combinedFixture.transactions[0].details = buildMaxTransaction(
    bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0xee), network: bitcoin.networks.bitcoin }).output,
    Buffer.from(combinedFixture.addresses[0].scriptPubKey, 'hex'),
    Array.from({ length: 25000 }, () => ({ txid: '11'.repeat(32) })), 25000,
  );
  combinedFixture.outputCount = 25000;
  combinedFixture.weight = bitcoin.Transaction.fromHex(combinedFixture.transactions[0].details.hex).weight();
  const combinedPath = persistPreparedMaxFixture('combined', combinedFixture);
  combinedFixture = undefined;
  if (typeof global.gc === 'function') global.gc();
  emit('replay_ready', {
    rssBytes: process.memoryUsage().rss,
    firstPageUnionSha256: fixture.firstPageDigest,
    stagedMaxFixtureBytes,
  });
  await new Promise(resolvePromise => process.once('SIGUSR2', resolvePromise));
  try {
    const compiledInputLimit = evidenceAuthentication.MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION;
    const compiledOutputLimit = evidenceAuthentication.MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION;
    const projectionLimits = {
      maxInputs: compiledInputLimit,
      maxOutputs: compiledOutputLimit,
      maxScriptHexChars: Number.MAX_SAFE_INTEGER,
    };
    const inputCases = manifest.maxAxes.inputCounts.map(count => ({
      count,
      admittedByCompiledProjector: evidenceProjection.transactionEvidenceFitsProjectionLimits(
        { inputs: count, outputs: 0, scriptHexChars: 0 }, projectionLimits,
      ),
    }));
    const outputCases = manifest.maxAxes.outputCounts.map(count => ({
      count,
      admittedByCompiledProjector: evidenceProjection.transactionEvidenceFitsProjectionLimits(
        { inputs: 0, outputs: count, scriptHexChars: 0 }, projectionLimits,
      ),
    }));
    if (compiledInputLimit !== manifest.maxAxes.inputLimit || compiledOutputLimit !== manifest.maxAxes.outputLimit
      || inputCases.map(item => item.admittedByCompiledProjector).join('|') !== 'true|true|false'
      || outputCases.map(item => item.admittedByCompiledProjector).join('|') !== 'true|true|false') {
      throw new Error('Compiled count boundaries do not match the sealed manifest');
    }
    emit('max_count_contract', { compiledInputLimit, compiledOutputLimit, inputCases, outputCases });
    for (const { label, axis, ordinal, expected, successPath, rollbackPath } of acceptedCases) {
      emit('max_axis_started', { label, axis, ordinal });
      await exerciseAcceptedMaxAxis(axis, ordinal, expected, successPath, rollbackPath);
    }
    const acceptedBoundaryCases = [
      [boundaryPaths.belowOutputCount, undefined],
      [boundaryPaths.atOutputCount, undefined],
      [boundaryPaths.belowWeight, 3999996],
      [boundaryPaths.atWeight, 4000000],
    ];
    for (const [path, expectedWeight] of acceptedBoundaryCases) {
      let accepted = loadPreparedMaxFixture(path);
      if (expectedWeight !== undefined && accepted.weight !== expectedWeight) throw new Error('Joint-weight boundary fixture drifted');
      const { context } = contextFor(accepted, Date.now() + 120000);
      const acceptedTxids = await evidenceAuthentication.fetchAuthenticatedTransactions(
        context, [accepted.transactions[0].details.txid],
      );
      if (!acceptedTxids.has(accepted.transactions[0].details.txid)) throw new Error('Boundary authentication failed');
      accepted = undefined;
      if (typeof global.gc === 'function') global.gc();
    }
    await withCaseWatchdog('output-count-above', 120000, signal =>
      assertRejectedBoundary(loadPreparedMaxFixture(boundaryPaths.aboveOutputCount), 'output_count_above', signal));
    await withCaseWatchdog('weight-above', 120000, signal => {
      const fixture = loadPreparedMaxFixture(boundaryPaths.aboveWeight);
      if (fixture.weight !== 4000004) throw new Error('Joint-weight above-boundary fixture drifted');
      return assertRejectedBoundary(fixture, 'weight_above', signal);
    });
    for (const [count, path] of [[24999, boundaryPaths.input24999], [25000, boundaryPaths.input25000], [25001, boundaryPaths.input25001]]) {
      await withCaseWatchdog(`input-count-${count}`, 120000, signal =>
        assertRejectedBoundary(loadPreparedMaxFixture(path), `input_count_${count}`, signal));
    }
    await withCaseWatchdog('combined-25000-by-25000', 120000, signal =>
      assertRejectedBoundary(loadPreparedMaxFixture(combinedPath), 'combined_25000_by_25000', signal));
    if (stagedMaxFixtureBytes !== 0) throw new Error(`Max fixture staging leaked ${stagedMaxFixtureBytes} bytes`);
    emit('replay_completed', { traceSha256: sha256(canonicalJson(trace)), rssBytes: process.memoryUsage().rss });
  } finally {
    if (typeof global.gc === 'function') global.gc();
    emit('replay_cleanup_completed', {
      rssBytes: process.memoryUsage().rss,
      threads: (await readdir('/proc/self/task')).length,
      baselineThreads,
    });
    await new Promise(resolvePromise => process.once('SIGHUP', resolvePromise));
  }
}

async function main() {
  await prisma.$queryRawUnsafe('SELECT 1');
  const baselineThreads = (await readdir('/proc/self/task')).length;
  const health = startHealthServer({
    port: 3002,
    healthProvider: { getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }) },
  });
  try {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    emit('replay_idle', { rssBytes: process.memoryUsage().rss, baselineThreads, compiledRoot: COMPILED_ROOT });
    await new Promise(resolvePromise => process.once('SIGUSR1', resolvePromise));
    const fixture = buildFixture(bitcoin);
    assertManifest(fixture);
    if (mode === 'live') await runLive(fixture, baselineThreads);
    else if (mode === 'max') {
      const fixtureSeal = { firstPageDigest: fixture.firstPageDigest };
      fixture.rawTransactions.clear();
      fixture.histories.clear();
      fixture.utxos.clear();
      fixture.transactions.length = 0;
      fixture.previousTransactions.length = 0;
      if (typeof global.gc === 'function') global.gc();
      await runMax(fixtureSeal, baselineThreads);
    }
    else throw new Error(`Unknown replay mode: ${mode}`);
  } finally {
    await health.close();
    await prismaModule.disconnect();
  }
}

main().then(
  () => process.exit(0),
  error => {
    emit('replay_failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      trace,
      rssBytes: process.memoryUsage().rss,
    });
    process.exit(1);
  },
);

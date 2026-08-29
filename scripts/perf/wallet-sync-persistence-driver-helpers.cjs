'use strict';

const { createHash } = require('node:crypto');

function createDriverHelpers({
  bitcoin,
  canonicalJson,
  classificationVersion,
  emit,
  emitResourceCheckpoint,
  prisma,
  sha256,
}) {
  function createArchitectureCollector(fixture) {
    const state = createArchitectureState();
    return {
      observe: event => observeArchitectureEvent(state, fixture, event, emitResourceCheckpoint),
      receipt: expected => architectureReceipt(state, expected, canonicalJson, sha256),
    };
  }

  async function seedDatabase(fixture) {
    const definition = fixture.definition;
    await prisma.wallet.create({ data: walletSeed(definition) });
    await prisma.address.createMany({ data: fixture.addresses.map(addressSeed) });
    await prisma.transaction.createMany({
      data: fixture.transactions.map((item, index) => transactionSeed(
        fixture, item, index, classificationVersion,
      )),
    });
    await prisma.transactionOutput.createMany({
      data: definition.seededOutputs.map(seed => outputSeed(fixture, seed)),
    });
    await prisma.uTXO.createMany({
      data: [...fixture.negativeUtxoSentinels, fixture.seededValidUtxo].map(utxo => ({
        ...utxo,
        walletId: definition.walletId,
        amount: BigInt(utxo.amount),
      })),
    });
  }

  async function databaseReceipt(fixture, event, pass) {
    const receipt = await collectDatabaseReceipt(prisma, fixture, canonicalJson, sha256);
    emit(event, { pass, ...receipt, cursors: undefined, utxos: undefined, drafts: undefined });
    return receipt;
  }

  return {
    assertPreStartUtxos,
    assertValidUtxoReceipt: (fixture, receipt) => assertValidUtxoReceipt(bitcoin, fixture, receipt),
    createArchitectureCollector,
    databaseReceipt,
    seedDatabase,
  };
}

function createArchitectureState() {
  return {
    compact: new Map(),
    full: [],
    remoteRefetchTxids: [],
    events: [],
    remotelyRequested: new Set(),
    sourceRawHexCharsHighWater: 0,
    retainedCanonicalBytes: 0,
    canonicalBytesHighWater: 0,
    maxFullCurrentCount: 0,
    maxTxDetailsCacheSize: 0,
  };
}

function observeArchitectureEvent(state, fixture, event, checkpoint) {
  state.events.push(event);
  if (event.type === 'compact_project') observeCompact(state, event);
  else if (event.type === 'full_project') observeFull(state, event);
  else if (event.type === 'cache_state') observeCache(state, event);
  else if (event.type === 'remote_fetch') observeRemote(state, fixture, event);
  if (event.type === 'full_project') checkpoint('after_full_candidate', { txid: event.txid });
  if (event.type === 'cache_state' && event.reason === 'release') {
    checkpoint('after_candidate_release', { txid: event.txid });
  }
}

function observeCompact(state, event) {
  const prior = state.compact.get(event.txid);
  state.retainedCanonicalBytes += prior
    ? event.canonicalBytes - prior.canonicalBytes
    : event.canonicalBytes;
  state.compact.set(event.txid, { digest: event.digest, canonicalBytes: event.canonicalBytes });
  state.canonicalBytesHighWater = Math.max(
    state.canonicalBytesHighWater,
    state.retainedCanonicalBytes,
  );
}

function observeFull(state, event) {
  state.full.push(event);
  state.maxTxDetailsCacheSize = Math.max(state.maxTxDetailsCacheSize, event.txDetailsCacheSize);
}

function observeCache(state, event) {
  state.maxFullCurrentCount = Math.max(state.maxFullCurrentCount, event.fullCurrentCount);
  state.maxTxDetailsCacheSize = Math.max(state.maxTxDetailsCacheSize, event.txDetailsCacheSize);
}

function observeRemote(state, fixture, event) {
  state.remoteRefetchTxids.push(...event.refetchTxids);
  for (const txid of event.txids) {
    if (state.remotelyRequested.has(txid)) continue;
    state.remotelyRequested.add(txid);
    const details = fixture.rawTransactions.get(txid);
    state.sourceRawHexCharsHighWater += details?.hex?.length
      ?? (details?.raw ? details.raw.byteLength * 2 : 0);
  }
}

function architectureReceipt(state, expectedFullTxids, canonicalJson, sha256) {
  const expected = [...expectedFullTxids].sort();
  const actual = state.full.map(event => event.txid).sort();
  const fullParentOrUtxo = state.full.filter(event => event.role !== 'current');
  const reuse = state.events.filter(event => event.type === 'compact_to_full_reuse');
  const exactOutputs = state.events.filter(event => event.type === 'exact_output_project');
  const exactBatches = state.events.filter(event => event.type === 'exact_output_batch_project');
  assertArchitecture(state, expectedFullTxids, expected, actual, fullParentOrUtxo, reuse, exactBatches);
  return {
    compactProjectCount: state.compact.size,
    compactProjectTxidDigest: sha256(canonicalJson([...state.compact.keys()].sort())),
    canonicalBytesHighWater: state.canonicalBytesHighWater,
    sourceRawHexCharsHighWater: state.sourceRawHexCharsHighWater,
    fullProjectCount: actual.length,
    fullProjectTxidDigest: sha256(canonicalJson(actual)),
    expectedFullProjectTxidDigest: sha256(canonicalJson(expected)),
    maxFullCurrentCount: state.maxFullCurrentCount,
    maxTxDetailsCacheSize: state.maxTxDetailsCacheSize,
    fullParentOrUtxoMaterializations: fullParentOrUtxo.length,
    compactToFullLocalReuseCount: reuse.length,
    remoteRefetchCount: state.remoteRefetchTxids.length,
    selectedCandidateRemoteRefetchCount: state.remoteRefetchTxids.filter(
      txid => expectedFullTxids.has(txid),
    ).length,
    exactParentOutputProjects: exactOutputs.filter(event => event.role === 'parent').length,
    exactUtxoOutputProjects: exactOutputs.filter(event => event.role === 'utxo').length,
    exactParentProjectionOperations: exactBatches.filter(event => event.role === 'parent').length,
    exactUtxoProjectionOperations: exactBatches.filter(event => event.role === 'utxo').length,
    maxExactOutputsPerProjection: Math.max(0, ...exactBatches.map(exactBatchSize)),
  };
}

function assertArchitecture(state, expectedTxids, expected, actual, fullOther, reuse, batches) {
  if (actual.length !== expected.length || actual.some((txid, index) => txid !== expected[index])) {
    throw new Error('Architecture full-project set did not match the fixture-derived candidate set');
  }
  if (state.maxFullCurrentCount > 1 || state.maxTxDetailsCacheSize > 1 || fullOther.length > 0) {
    throw new Error('Architecture full-materialization high-water contract failed');
  }
  if (reuse.length !== state.full.length) throw new Error('Architecture compact-to-full reuse count mismatch');
  if (state.remoteRefetchTxids.some(txid => expectedTxids.has(txid))) {
    throw new Error('Selected candidate was remotely refetched after compact sealing');
  }
  const keys = batches.map(event => `${event.role}:${event.txid}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Exact outpoint evidence reparsed one role/transaction more than once');
  }
}

const exactBatchSize = event => event.vouts.length
  + event.missingVouts.length
  + (event.invalidVouts?.length ?? 0);

function walletSeed(definition) {
  return {
    id: definition.walletId,
    name: 'High fanout persistence replay',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: definition.network,
    syncInProgress: true,
    syncExecutionOwner: 'worker',
    requestedIncrementalSyncGeneration: definition.leaseGeneration,
    claimedIncrementalSyncGeneration: definition.leaseGeneration,
    incrementalSyncLeaseToken: definition.leaseToken,
    incrementalSyncClaimedAt: new Date(),
    incrementalSyncLeaseExpiresAt: new Date(Date.now() + 2 * 60 * 60_000),
  };
}

const addressSeed = address => ({
  id: address.id,
  walletId: address.walletId,
  address: address.address,
  derivationPath: address.derivationPath,
  index: address.index,
  used: address.used,
  createdAt: address.createdAt,
});

function transactionSeed(fixture, item, index, classificationVersion) {
  return {
    id: `replay-transaction-${index}`,
    txid: item.details.txid,
    walletId: fixture.definition.walletId,
    addressId: fixture.addresses[item.addressIndex].id,
    type: 'received',
    classificationInputsComplete: true,
    classificationVersion,
    classificationAddressCount: fixture.definition.addressCount,
    classificationLastAttemptAt: new Date(index * 1000),
    ioComplete: false,
    ioLastAttemptAt: new Date(index * 1000),
    amount: 1n,
    fee: 0n,
    balanceAfter: 0n,
    confirmations: 1,
    blockHeight: 800000 + item.addressIndex,
    blockTime: new Date(1700000000000 + index * 1000),
    rbfStatus: 'confirmed',
  };
}

const outputSeed = (fixture, seed) => ({
  id: seed.id,
  transactionId: `replay-transaction-${seed.transactionIndex}`,
  outputIndex: seed.outputIndex,
  address: fixture.externalAddress,
  amount: 1n,
  scriptPubKey: fixture.externalScriptHex,
  outputType: 'unknown',
  isOurs: false,
  label: seed.label,
});

async function rowDigest(model, where, orderBy, select, canonicalJson) {
  const hash = createHash('sha256');
  let cursor;
  let first = true;
  hash.update('[');
  for (;;) {
    const rows = await model.findMany({
      where,
      orderBy: [...orderBy, { id: 'asc' }],
      select,
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      if (!first) hash.update(',');
      hash.update(canonicalJson(normalizeEvidenceRow(row)));
      first = false;
    }
    if (rows.length < 1000) break;
    cursor = rows.at(-1).id;
  }
  hash.update(']');
  return hash.digest('hex');
}

function normalizeEvidenceRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? value.toString() : value instanceof Date ? value.toISOString() : value,
  ]));
}

async function collectDatabaseReceipt(prisma, fixture, canonicalJson, sha256) {
  const walletId = fixture.definition.walletId;
  const rows = await queryReceiptRows(prisma, fixture, walletId, canonicalJson);
  const normalizedTransactions = rows.cursors.map(normalizeEvidenceRow);
  const walletLifecycle = normalizeEvidenceRow(rows.walletLifecycleRow);
  const normalizedUtxos = rows.utxoRows.map(normalizeEvidenceRow);
  const normalizedDrafts = rows.draftRows.map(normalizeEvidenceRow);
  return {
    transactions: rows.transactions,
    complete: rows.complete,
    incomplete: rows.transactions - rows.complete,
    inputs: rows.inputs,
    outputs: rows.outputs,
    seeded: rows.seeded,
    cursorDigest: sha256(canonicalJson(normalizedTransactions.map(cursorIdentity))),
    transactionEvidenceDigest: sha256(canonicalJson(normalizedTransactions)),
    walletLifecycle,
    walletLifecycleDigest: sha256(canonicalJson(walletLifecycle)),
    cursors: rows.cursors,
    balanceMarkers: Number(rows.balanceMarkers[0]?.count || 0),
    inputDigest: rows.inputDigest,
    outputDigest: rows.outputDigest,
    utxos: normalizedUtxos,
    utxoCount: normalizedUtxos.length,
    utxoDigest: sha256(canonicalJson(normalizedUtxos)),
    drafts: normalizedDrafts,
    draftCount: normalizedDrafts.length,
    draftDigest: sha256(canonicalJson(normalizedDrafts)),
  };
}

const cursorIdentity = row => ({
  id: row.id,
  txid: row.txid,
  ioComplete: row.ioComplete,
  ioLastAttemptAt: row.ioLastAttemptAt,
});

async function queryReceiptRows(prisma, fixture, walletId, canonicalJson) {
  const values = await Promise.all([
    prisma.transaction.count({ where: { walletId } }),
    prisma.transaction.count({ where: { walletId, ioComplete: true } }),
    prisma.transactionInput.count({ where: { transaction: { walletId } } }),
    prisma.transactionOutput.count({ where: { transaction: { walletId } } }),
    prisma.transactionOutput.findMany({
      where: { id: { in: fixture.definition.seededOutputs.map(seed => seed.id) } },
      select: { id: true, label: true, transactionId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { walletId },
      select: transactionReceiptSelect(),
      orderBy: [{ ioLastAttemptAt: 'asc' }, { txid: 'asc' }],
    }),
    prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: walletLifecycleSelect(),
    }),
    prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS count FROM "wallet_balance_repairs" WHERE "walletId" = $1',
      walletId,
    ),
    rowDigest(prisma.transactionInput, { transaction: { walletId } }, [
      { transactionId: 'asc' }, { inputIndex: 'asc' },
    ], inputReceiptSelect(), canonicalJson),
    rowDigest(prisma.transactionOutput, { transaction: { walletId } }, [
      { transactionId: 'asc' }, { outputIndex: 'asc' },
    ], outputReceiptSelect(), canonicalJson),
    prisma.uTXO.findMany({
      where: { walletId }, select: utxoReceiptSelect(), orderBy: [{ txid: 'asc' }, { vout: 'asc' }],
    }),
    prisma.draftTransaction.findMany({
      where: { walletId },
      select: { id: true, status: true, selectedUtxoIds: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const names = [
    'transactions', 'complete', 'inputs', 'outputs', 'seeded', 'cursors',
    'walletLifecycleRow', 'balanceMarkers', 'inputDigest', 'outputDigest', 'utxoRows', 'draftRows',
  ];
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

const transactionReceiptSelect = () => ({
  id: true, txid: true, type: true, amount: true, fee: true, balanceAfter: true,
  confirmations: true, blockHeight: true, blockTime: true, rbfStatus: true,
  ioComplete: true, ioLastAttemptAt: true, classificationInputsComplete: true,
  classificationVersion: true, classificationAddressCount: true, classificationLastAttemptAt: true,
});

const walletLifecycleSelect = () => ({
  lastSyncedAt: true, lastSyncedBlockHeight: true, lastSyncStatus: true, lastSyncError: true,
  lastSyncFailureClass: true, syncInProgress: true, syncExecutionOwner: true, syncRetryCount: true,
  syncNextRetryAt: true, syncStartedAt: true, syncStateVersion: true,
  requestedIncrementalSyncGeneration: true, claimedIncrementalSyncGeneration: true,
  processedIncrementalSyncGeneration: true, incrementalSyncLeaseToken: true,
  incrementalSyncClaimedAt: true, incrementalSyncLeaseExpiresAt: true, syncActionRequiredAt: true,
  requestedFullResyncGeneration: true, preparedFullResyncGeneration: true,
  processedFullResyncGeneration: true,
});

const inputReceiptSelect = () => ({
  id: true, transactionId: true, inputIndex: true, txid: true, vout: true,
  address: true, amount: true, derivationPath: true,
});

const outputReceiptSelect = () => ({
  id: true, transactionId: true, outputIndex: true, address: true, amount: true,
  scriptPubKey: true, outputType: true, isOurs: true, label: true,
});

const utxoReceiptSelect = () => ({
  id: true, txid: true, vout: true, address: true, amount: true, scriptPubKey: true,
  confirmations: true, blockHeight: true, spent: true, spentTxid: true, frozen: true,
});

function assertValidUtxoReceipt(bitcoin, fixture, receipt) {
  const expected = [...fixture.validUtxos.entries()].flatMap(([address, utxos]) => (
    utxos.map(utxo => ({ address, utxo }))
  ));
  const rows = new Map(receipt.utxos.map(row => [`${row.txid}:${row.vout}`, row]));
  const expectedCount = expected.length + fixture.negativeUtxoSentinels.length;
  if (receipt.utxos.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} sealed UTXOs, received ${receipt.utxos.length}`);
  }
  expected.forEach(({ address, utxo }) => assertValidUtxo(bitcoin, fixture, rows, address, utxo));
  for (const sentinel of fixture.negativeUtxoSentinels) assertNegativeUtxo(rows, sentinel);
  if (receipt.drafts.length !== 0) throw new Error('Replay unexpectedly created or retained draft state');
}

function assertValidUtxo(bitcoin, fixture, rows, address, utxo) {
  const row = rows.get(`${utxo.tx_hash}:${utxo.tx_pos}`);
  const transaction = fixture.rawTransactions.get(utxo.tx_hash);
  const script = Buffer.from(
    bitcoin.Transaction.fromHex(transaction.hex).outs[utxo.tx_pos].script,
  ).toString('hex');
  if (!row || row.txid !== utxo.tx_hash || row.vout !== utxo.tx_pos || row.address !== address
    || row.amount !== String(utxo.value) || row.scriptPubKey !== script || row.spent !== false
    || row.blockHeight !== utxo.height
    || row.confirmations !== Math.max(0, 800000 - utxo.height + 1)) {
    throw new Error(`Exact UTXO receipt mismatch for ${utxo.tx_hash}:${utxo.tx_pos}`);
  }
  if (utxo.tx_hash === fixture.seededValidUtxo.txid && row.id !== fixture.seededValidUtxo.id) {
    throw new Error('Seeded valid UTXO identity was not preserved');
  }
}

function assertNegativeUtxo(rows, sentinel) {
  const row = rows.get(`${sentinel.txid}:${sentinel.vout}`);
  if (!row || row.id !== sentinel.id || row.address !== sentinel.address
    || row.amount !== String(sentinel.amount) || row.scriptPubKey !== sentinel.scriptPubKey
    || row.confirmations !== sentinel.confirmations || row.blockHeight !== sentinel.blockHeight
    || row.spent !== sentinel.spent) {
    throw new Error(`Negative/omitted UTXO changed for ${sentinel.id}`);
  }
}

function assertPreStartUtxos(fixture, receipt) {
  if (receipt.utxos.length !== fixture.negativeUtxoSentinels.length + 1
    || receipt.drafts.length !== 0) {
    throw new Error('Pre-start UTXO/draft receipt does not match sealed negative cases');
  }
  const ids = new Set(receipt.utxos.map(row => row.id));
  if (fixture.negativeUtxoSentinels.some(row => !ids.has(row.id))) {
    throw new Error('Pre-start negative UTXO identities are incomplete');
  }
  if (!ids.has(fixture.seededValidUtxo.id)) throw new Error('Pre-start seeded valid UTXO is missing');
}

module.exports = { createDriverHelpers };

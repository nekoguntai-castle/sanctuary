'use strict';

const { createHash } = require('node:crypto');

const FIXTURE_DEFINITION = Object.freeze({
  schemaVersion: 1,
  network: 'mainnet',
  walletId: '00000000-0000-4000-8000-000000000869',
  leaseToken: '00000000-0000-4000-8000-000000000870',
  leaseGeneration: 1,
  addressCount: 47,
  historyRowCount: 184,
  transactionCount: 169,
  previousTransactionCount: 47,
  totalOutputCount: 471732,
  largeTransactionCount: 53,
  largeTransactionOutputs: 2792,
  regularTransactionOutputs: 2791,
  pageSize: 100,
  seededOutputs: [
    { id: 'replay-seeded-output-0', transactionIndex: 0, outputIndex: 0, label: 'preserved replay label' },
    { id: 'replay-seeded-output-1', transactionIndex: 1, outputIndex: 0, label: null },
  ],
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createWalletAddress(bitcoin, index) {
  const hash = Buffer.alloc(20);
  hash.writeUInt32BE(index + 1, hash.length - 4);
  const payment = bitcoin.payments.p2wpkh({ hash, network: bitcoin.networks.bitcoin });
  if (!payment.address || !payment.output) throw new Error(`Could not build replay address ${index}`);
  return {
    address: {
      id: `replay-address-${index}`,
      walletId: FIXTURE_DEFINITION.walletId,
      address: payment.address,
      derivationPath: `m/84'/0'/0'/0/${index}`,
      index,
      branch: 0,
      coordinateVersion: 1,
      canonicalPolicyId: 'single_sig_native_segwit',
      canonicalPolicyVersion: 1,
      scriptPubKey: Buffer.from(payment.output).toString('hex'),
      used: false,
      createdAt: new Date(0),
    },
    script: payment.output,
  };
}

function createRawTransaction(bitcoin, externalScript, index, outputCount, ownedScript, previousTxid, secondaryScript) {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.locktime = index;
  transaction.addInput(
    previousTxid ? Buffer.from(previousTxid, 'hex').reverse() : new Uint8Array(32),
    previousTxid ? 0 : 0xffffffff,
    undefined,
    previousTxid ? undefined : Buffer.from([1, index & 0xff]),
  );
  for (let outputIndex = secondaryScript ? 2 : 1; outputIndex < outputCount; outputIndex++) {
    transaction.addOutput(externalScript, 1n);
  }
  if (secondaryScript) transaction.addOutput(secondaryScript, 1n);
  transaction.addOutput(ownedScript, 1n);
  return { txid: transaction.getId(), hex: transaction.toHex(), vin: [], vout: [] };
}

function buildFixture(bitcoin) {
  const externalScript = bitcoin.payments.p2wpkh({
    hash: Buffer.alloc(20, 0xff),
    network: bitcoin.networks.bitcoin,
  }).output;
  if (!externalScript) throw new Error('Could not build replay external script');
  const externalAddress = bitcoin.address.fromOutputScript(externalScript, bitcoin.networks.bitcoin);
  const walletAddresses = Array.from(
    { length: FIXTURE_DEFINITION.addressCount },
    (_, index) => createWalletAddress(bitcoin, index),
  );
  const previousTransactions = Array.from(
    { length: FIXTURE_DEFINITION.previousTransactionCount },
    (_, index) => createRawTransaction(bitcoin, externalScript, 10000 + index, 1, externalScript),
  );
  const transactions = Array.from({ length: FIXTURE_DEFINITION.transactionCount }, (_, index) => {
    const addressIndex = index % walletAddresses.length;
    const secondaryAddressIndex = index < FIXTURE_DEFINITION.historyRowCount - FIXTURE_DEFINITION.transactionCount
      ? (addressIndex + 1) % walletAddresses.length
      : undefined;
    const outputCount = index < FIXTURE_DEFINITION.largeTransactionCount
      ? FIXTURE_DEFINITION.largeTransactionOutputs
      : FIXTURE_DEFINITION.regularTransactionOutputs;
    return {
      addressIndex,
      hasPreviousInput: index < previousTransactions.length,
      secondaryAddressIndex,
      outputCount,
      details: createRawTransaction(
        bitcoin,
        externalScript,
        index,
        outputCount,
        walletAddresses[addressIndex].script,
        index < previousTransactions.length ? previousTransactions[index].txid : undefined,
        secondaryAddressIndex === undefined ? undefined : walletAddresses[secondaryAddressIndex].script,
      ),
    };
  });
  const actualOutputs = transactions.reduce((sum, item) => sum + item.outputCount, 0);
  if (actualOutputs !== FIXTURE_DEFINITION.totalOutputCount) {
    throw new Error(`Replay output fixture drifted: ${actualOutputs}`);
  }
  const histories = new Map(walletAddresses.map(({ address }) => [address.address, []]));
  for (const item of transactions) {
    const history = { tx_hash: item.details.txid, height: 800000 + item.addressIndex };
    histories.get(walletAddresses[item.addressIndex].address.address).push(history);
    if (item.secondaryAddressIndex !== undefined) {
      histories.get(walletAddresses[item.secondaryAddressIndex].address.address).push(history);
    }
  }
  const historyRows = [...histories.values()].reduce((sum, rows) => sum + rows.length, 0);
  if (historyRows !== FIXTURE_DEFINITION.historyRowCount) throw new Error(`Replay history fixture drifted: ${historyRows}`);
  const utxoOnlyTransaction = createRawTransaction(
    bitcoin, externalScript, 20000, 1, walletAddresses.at(-1).script,
  );
  const validUtxos = new Map(walletAddresses.map(({ address }, addressIndex) => {
    const item = transactions.find(candidate => candidate.addressIndex === addressIndex);
    if (!item) throw new Error(`Replay UTXO fixture missing address ${addressIndex}`);
    if (addressIndex === walletAddresses.length - 1) {
      return [address.address, [{
        tx_hash: utxoOnlyTransaction.txid, tx_pos: 0, value: 1, height: 800000 + addressIndex,
      }]];
    }
    return [address.address, [{
      tx_hash: item.details.txid,
      tx_pos: item.outputCount - 1,
      value: 1,
      height: 800000 + addressIndex,
    }]];
  }));
  const utxos = new Map([...validUtxos].map(([address, rows]) => [address, [...rows]]));
  const firstValid = validUtxos.get(walletAddresses[0].address.address)[0];
  const seededValidUtxo = {
    id: 'replay-seeded-valid-utxo', txid: firstValid.tx_hash, vout: firstValid.tx_pos,
    address: walletAddresses[0].address.address, amount: firstValid.value,
    scriptPubKey: walletAddresses[0].address.scriptPubKey,
    confirmations: 0, blockHeight: null, spent: true,
  };
  const negativeListings = [
    { name: 'value_mismatch', addressIndex: 0, transactionIndex: 47, vout: transactions[47].outputCount - 1, value: 2 },
    { name: 'script_mismatch', addressIndex: 1, transactionIndex: 48, vout: 0, value: 1 },
    { name: 'missing_vout', addressIndex: 2, transactionIndex: 49, vout: transactions[49].outputCount, value: 1 },
    { name: 'cross_address', addressIndex: 4, transactionIndex: 50, vout: transactions[50].outputCount - 1, value: 1 },
  ].map(item => ({
    ...item,
    txid: transactions[item.transactionIndex].details.txid,
    height: 800100 + item.addressIndex,
  }));
  negativeListings.push({
    name: 'wrong_txid', addressIndex: 5, transactionIndex: 51,
    txid: '33'.repeat(32), vout: transactions[51].outputCount - 1, value: 1, height: 800105,
  });
  for (const item of negativeListings) {
    utxos.get(walletAddresses[item.addressIndex].address.address).push({
      tx_hash: item.txid, tx_pos: item.vout, value: item.value, height: item.height,
    });
  }
  const negativeUtxoSentinels = [
    ...negativeListings.map((item, index) => ({
      id: `replay-negative-utxo-${index}`,
      txid: item.txid,
      vout: item.vout,
      address: walletAddresses[item.addressIndex].address.address,
      amount: 1,
      scriptPubKey: walletAddresses[item.addressIndex].address.scriptPubKey,
      confirmations: 7,
      blockHeight: 700000 + index,
      spent: false,
    })),
    {
      id: 'replay-negative-utxo-omission', txid: '22'.repeat(32), vout: 0,
      address: walletAddresses[5].address.address, amount: 1,
      scriptPubKey: walletAddresses[5].address.scriptPubKey,
      confirmations: 7, blockHeight: 700100, spent: false,
    },
  ];
  const firstPage = transactions.slice(0, FIXTURE_DEFINITION.pageSize);
  const firstPageUnion = {
    txids: firstPage.map(item => item.details.txid),
    inputs: firstPage.filter(item => item.hasPreviousInput).length,
    outputs: firstPage.reduce((sum, item) => sum + item.outputCount, 0),
  };
  const firstPageDigest = sha256(canonicalJson(firstPageUnion));
  return {
    definition: FIXTURE_DEFINITION,
    definitionDigest: sha256(canonicalJson(FIXTURE_DEFINITION)),
    addresses: walletAddresses.map(item => item.address),
    histories,
    transactions,
    rawTransactions: new Map([
      ...transactions.map(item => [item.details.txid, item.details]),
      ...previousTransactions.map(item => [item.txid, item]),
      [utxoOnlyTransaction.txid, utxoOnlyTransaction],
      ['33'.repeat(32), transactions[51].details],
    ]),
    previousTransactions,
    utxos,
    validUtxos,
    seededValidUtxo,
    negativeListings,
    negativeUtxoSentinels,
    utxoOnlyTransaction,
    externalAddress,
    externalScriptHex: Buffer.from(externalScript).toString('hex'),
    firstPageUnion,
    firstPageDigest,
  };
}

module.exports = { FIXTURE_DEFINITION, buildFixture, canonicalJson, sha256 };

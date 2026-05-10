import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  BroadcastPreflightError,
  verifyElectrumBroadcastPreflight,
} from '../../../../../src/services/bitcoin/blockchain/broadcastPreflight';
import type { TransactionDetails, TransactionOutput } from '../../../../../src/services/bitcoin/electrum';
import { testnetAddresses } from '../../../../fixtures/bitcoin';

const TESTNET = bitcoin.networks.testnet;
const PREV_TXID = 'a'.repeat(64);
const PREV_VALUE_SATS = 50_000;
const RECIPIENT = testnetAddresses.nativeSegwit[1];

type PreflightClient = Parameters<typeof verifyElectrumBroadcastPreflight>[0];

const scriptHexForAddress = (address: string): string => {
  return Buffer.from(bitcoin.address.toOutputScript(address, TESTNET)).toString('hex');
};

const createSpendingRawTx = (
  txid: string = PREV_TXID,
  vout: number = 0,
  options: { duplicateInput?: boolean; coinbaseInput?: boolean } = {},
): string => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  const inputHash = options.coinbaseInput
    ? Buffer.alloc(32)
    : Buffer.from(txid, 'hex').reverse();
  tx.addInput(inputHash, options.coinbaseInput ? 0xffffffff : vout);
  if (options.duplicateInput) {
    tx.addInput(inputHash, vout);
  }
  tx.addOutput(bitcoin.address.toOutputScript(RECIPIENT, TESTNET), BigInt(1_000));
  return tx.toHex();
};

const createZeroInputRawTx = (): string => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addOutput(bitcoin.address.toOutputScript(RECIPIENT, TESTNET), BigInt(1_000));
  return tx.toHex();
};

const createPrevOutput = (
  overrides: Partial<TransactionOutput> = {},
): TransactionOutput => {
  const address = testnetAddresses.nativeSegwit[0];
  return {
    value: PREV_VALUE_SATS / 100_000_000,
    n: 0,
    scriptPubKey: {
      hex: scriptHexForAddress(address),
      address,
      addresses: [address],
    },
    ...overrides,
  };
};

const createPrevTransaction = (
  outputs: TransactionOutput[] = [createPrevOutput()],
): TransactionDetails => ({
  txid: PREV_TXID,
  hash: PREV_TXID,
  version: 2,
  size: 100,
  locktime: 0,
  vin: [],
  vout: outputs,
  hex: '00',
});

const createClient = (options: {
  previousTransactions?: Map<string, TransactionDetails>;
  unspentByAddress?: Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>;
  transactionError?: Error;
  utxoError?: Error;
} = {}): PreflightClient => {
  const prevOutput = createPrevOutput();
  const defaultAddress = prevOutput.scriptPubKey.address!;
  return {
    getTransactionsBatch: vi.fn(async () => {
      if (options.transactionError) throw options.transactionError;
      return options.previousTransactions ?? new Map([[PREV_TXID, createPrevTransaction([prevOutput])]]);
    }),
    getAddressUTXOsBatch: vi.fn(async () => {
      if (options.utxoError) throw options.utxoError;
      return options.unspentByAddress ?? new Map([[
        defaultAddress,
        [{ tx_hash: PREV_TXID, tx_pos: 0, height: 1, value: PREV_VALUE_SATS }],
      ]]);
    }),
  };
};

const expectPreflightFailure = async (
  client: PreflightClient,
  rawTx: string,
): Promise<BroadcastPreflightError> => {
  try {
    await verifyElectrumBroadcastPreflight(client, rawTx);
  } catch (error) {
    expect(error).toBeInstanceOf(BroadcastPreflightError);
    return error as BroadcastPreflightError;
  }
  throw new Error('Expected preflight failure');
};

describe('Electrum broadcast preflight', () => {
  it('passes when every input prevout is fetchable and still unspent', async () => {
    const client = createClient();
    const rawTx = createSpendingRawTx();

    const result = await verifyElectrumBroadcastPreflight(client, rawTx);

    expect(result).toEqual({
      txid: expect.any(String),
      inputCount: 1,
      checkedOutpoints: [`${PREV_TXID}:0`],
    });
    expect(client.getTransactionsBatch).toHaveBeenCalledWith([PREV_TXID], true);
    expect(client.getAddressUTXOsBatch).toHaveBeenCalledWith([testnetAddresses.nativeSegwit[0]]);
  });

  it('fails closed when the previous transaction cannot be fetched', async () => {
    const client = createClient({ previousTransactions: new Map() });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({ reason: 'missing_previous_transaction', txid: PREV_TXID });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('fails closed when previous transaction lookup throws', async () => {
    const client = createClient({ transactionError: new Error('batch timeout') });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({ error: 'batch timeout' });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('fails closed when the previous transaction does not contain the spent vout', async () => {
    const client = createClient({
      previousTransactions: new Map([[PREV_TXID, createPrevTransaction([])]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_rejected');
    expect(error.details).toMatchObject({ reason: 'missing_previous_output', outpoint: `${PREV_TXID}:0` });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('fails closed when the previous output has no standard address', async () => {
    const client = createClient({
      previousTransactions: new Map([[
        PREV_TXID,
        createPrevTransaction([
          createPrevOutput({ scriptPubKey: { hex: '6a', addresses: [] } }),
        ]),
      ]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('unsupported_script');
    expect(error.details).toMatchObject({ reason: 'unsupported_previous_output_script' });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('accepts previous output address arrays when the primary address field is absent', async () => {
    const prevOutput = createPrevOutput({
      scriptPubKey: {
        hex: scriptHexForAddress(testnetAddresses.nativeSegwit[0]),
        addresses: [testnetAddresses.nativeSegwit[0]],
      },
    });
    const client = createClient({
      previousTransactions: new Map([[PREV_TXID, createPrevTransaction([prevOutput])]]),
      unspentByAddress: new Map([[
        testnetAddresses.nativeSegwit[0],
        [{ tx_hash: PREV_TXID, tx_pos: 0, height: 1, value: PREV_VALUE_SATS }],
      ]]),
    });

    await expect(verifyElectrumBroadcastPreflight(client, createSpendingRawTx())).resolves.toMatchObject({
      inputCount: 1,
    });
  });

  it('fails closed when the previous output value is malformed', async () => {
    const client = createClient({
      previousTransactions: new Map([[
        PREV_TXID,
        createPrevTransaction([createPrevOutput({ value: Number.NaN })]),
      ]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({ reason: 'invalid_prevout_value' });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('fails closed when the previous output value cannot be represented as safe sats', async () => {
    const client = createClient({
      previousTransactions: new Map([[
        PREV_TXID,
        createPrevTransaction([createPrevOutput({ value: Number.MAX_SAFE_INTEGER })]),
      ]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({ reason: 'invalid_prevout_value' });
    expect(client.getAddressUTXOsBatch).not.toHaveBeenCalled();
  });

  it('fails closed when Electrum no longer reports the prevout as unspent', async () => {
    const client = createClient({
      unspentByAddress: new Map([[testnetAddresses.nativeSegwit[0], []]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_rejected');
    expect(error.details).toMatchObject({ reason: 'stale_or_spent_input', outpoint: `${PREV_TXID}:0` });
    expect(client.getAddressUTXOsBatch).toHaveBeenCalledOnce();
  });

  it('fails closed when the address has UTXOs but none match the exact outpoint', async () => {
    const client = createClient({
      unspentByAddress: new Map([[
        testnetAddresses.nativeSegwit[0],
        [
          { tx_hash: 'b'.repeat(64), tx_pos: 0, height: 1, value: PREV_VALUE_SATS },
          { tx_hash: PREV_TXID, tx_pos: 1, height: 1, value: PREV_VALUE_SATS },
        ],
      ]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_rejected');
    expect(error.details).toMatchObject({ reason: 'stale_or_spent_input', outpoint: `${PREV_TXID}:0` });
  });

  it('fails closed when Electrum omits the address UTXO result', async () => {
    const client = createClient({ unspentByAddress: new Map() });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({
      reason: 'missing_address_utxo_result',
      address: testnetAddresses.nativeSegwit[0],
    });
  });

  it('fails closed when Electrum reports a different value for the prevout', async () => {
    const client = createClient({
      unspentByAddress: new Map([[
        testnetAddresses.nativeSegwit[0],
        [{ tx_hash: PREV_TXID, tx_pos: 0, height: 1, value: PREV_VALUE_SATS + 1 }],
      ]]),
    });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_rejected');
    expect(error.details).toMatchObject({
      reason: 'prevout_value_mismatch',
      expectedValueSats: PREV_VALUE_SATS,
      nodeValueSats: PREV_VALUE_SATS + 1,
    });
  });

  it('fails closed when Electrum UTXO lookup fails', async () => {
    const client = createClient({ utxoError: new Error('request timeout') });

    const error = await expectPreflightFailure(client, createSpendingRawTx());

    expect(error.reason).toBe('node_preflight_unavailable');
    expect(error.details).toMatchObject({ error: 'request timeout' });
  });

  it('rejects invalid, duplicate-input, and coinbase-style raw transactions before Electrum lookups', async () => {
    const invalidClient = createClient();
    const invalid = await expectPreflightFailure(invalidClient, 'not-hex');
    expect(invalid.reason).toBe('invalid_raw_transaction');
    expect(invalidClient.getTransactionsBatch).not.toHaveBeenCalled();

    const emptyClient = createClient();
    const empty = await expectPreflightFailure(emptyClient, createZeroInputRawTx());
    expect(empty.reason).toBe('invalid_raw_transaction');
    expect(emptyClient.getTransactionsBatch).not.toHaveBeenCalled();

    const duplicateClient = createClient();
    const duplicate = await expectPreflightFailure(duplicateClient, createSpendingRawTx(PREV_TXID, 0, {
      duplicateInput: true,
    }));
    expect(duplicate.reason).toBe('node_preflight_rejected');
    expect(duplicate.details).toMatchObject({ reason: 'duplicate_inputs' });
    expect(duplicateClient.getTransactionsBatch).not.toHaveBeenCalled();

    const coinbaseClient = createClient();
    const coinbase = await expectPreflightFailure(coinbaseClient, createSpendingRawTx(PREV_TXID, 0, {
      coinbaseInput: true,
    }));
    expect(coinbase.reason).toBe('node_preflight_rejected');
    expect(coinbase.details).toMatchObject({ reason: 'coinbase_input' });
    expect(coinbaseClient.getTransactionsBatch).not.toHaveBeenCalled();
  });
});

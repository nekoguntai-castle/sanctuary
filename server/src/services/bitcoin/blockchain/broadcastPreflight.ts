import * as bitcoin from 'bitcoinjs-lib';
import { getErrorMessage } from '../../../utils/errors';
import type { NodeClientInterface } from '../nodeClient';
import type { BroadcastErrorReason } from '../transactions/broadcastContracts';
import type { TransactionDetails, TransactionOutput } from '../electrum';

const SATS_PER_BTC = 100_000_000;
const COINBASE_PREVOUT_TXID = '0'.repeat(64);
const COINBASE_PREVOUT_VOUT = 0xffffffff;

type BroadcastInput = {
  txid: string;
  vout: number;
};

type ResolvedPrevout = BroadcastInput & {
  address: string;
  valueSats: number;
};

type PreflightClient = Pick<NodeClientInterface, 'getTransactionsBatch' | 'getAddressUTXOsBatch'>;

export interface ElectrumBroadcastPreflightResult {
  txid: string;
  inputCount: number;
  checkedOutpoints: string[];
}

export class BroadcastPreflightError extends Error {
  readonly reason: BroadcastErrorReason;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    reason: BroadcastErrorReason,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BroadcastPreflightError';
    this.reason = reason;
    this.details = details;
  }
}

const outpointKey = ({ txid, vout }: BroadcastInput): string => `${txid}:${vout}`;

const createPreflightError = (
  message: string,
  reason: BroadcastErrorReason,
  details: Record<string, unknown> = {},
): BroadcastPreflightError => new BroadcastPreflightError(message, reason, details);

const parseRawTransactionInputs = (rawTx: string): { txid: string; inputs: BroadcastInput[] } => {
  let tx: bitcoin.Transaction;
  try {
    tx = bitcoin.Transaction.fromHex(rawTx);
  } catch (error) {
    throw createPreflightError('Broadcast preflight could not parse raw transaction', 'invalid_raw_transaction', {
      error: getErrorMessage(error),
    });
  }

  return {
    txid: tx.getId(),
    inputs: tx.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
    })),
  };
};

const assertSpendableInputs = (inputs: BroadcastInput[]): void => {
  /* v8 ignore next -- bitcoinjs-lib rejects zero-input raw transactions before returning a Transaction. */
  if (inputs.length === 0) {
    throw createPreflightError('Broadcast preflight requires at least one transaction input', 'invalid_raw_transaction');
  }

  for (const input of inputs) {
    if (input.txid === COINBASE_PREVOUT_TXID && input.vout === COINBASE_PREVOUT_VOUT) {
      throw createPreflightError('Broadcast preflight rejected coinbase-style input', 'node_preflight_rejected', {
        reason: 'coinbase_input',
        outpoint: outpointKey(input),
      });
    }
  }
};

const assertUniqueInputs = (inputs: BroadcastInput[]): void => {
  const keys = inputs.map(outpointKey);
  if (new Set(keys).size === keys.length) return;

  throw createPreflightError('Broadcast preflight rejected duplicate transaction inputs', 'node_preflight_rejected', {
    reason: 'duplicate_inputs',
  });
};

const fetchPreviousTransactions = async (
  client: PreflightClient,
  inputs: BroadcastInput[],
): Promise<Map<string, TransactionDetails>> => {
  try {
    return await client.getTransactionsBatch([...new Set(inputs.map(input => input.txid))], true);
  } catch (error) {
    throw createPreflightError('Broadcast preflight could not fetch previous transactions', 'node_preflight_unavailable', {
      error: getErrorMessage(error),
    });
  }
};

const outputAddress = (output: TransactionOutput): string | undefined => {
  return output.scriptPubKey.address || output.scriptPubKey.addresses?.[0];
};

const normalizeOutputValueSats = (output: TransactionOutput, input: BroadcastInput): number => {
  const value = output.value;
  if (!Number.isFinite(value) || value < 0) {
    throw createPreflightError('Broadcast preflight received invalid previous output value', 'node_preflight_unavailable', {
      reason: 'invalid_prevout_value',
      outpoint: outpointKey(input),
    });
  }

  const valueSats = Math.round(value * SATS_PER_BTC);
  if (!Number.isSafeInteger(valueSats)) {
    throw createPreflightError('Broadcast preflight received invalid previous output value', 'node_preflight_unavailable', {
      reason: 'invalid_prevout_value',
      outpoint: outpointKey(input),
    });
  }

  return valueSats;
};

const resolvePrevout = (
  input: BroadcastInput,
  previousTransactions: Map<string, TransactionDetails>,
): ResolvedPrevout => {
  const previousTransaction = previousTransactions.get(input.txid);
  if (!previousTransaction) {
    throw createPreflightError('Broadcast preflight could not verify previous transaction', 'node_preflight_unavailable', {
      reason: 'missing_previous_transaction',
      txid: input.txid,
    });
  }

  const output = previousTransaction.vout?.[input.vout];
  if (!output) {
    throw createPreflightError('Broadcast preflight rejected missing previous output', 'node_preflight_rejected', {
      reason: 'missing_previous_output',
      outpoint: outpointKey(input),
    });
  }

  const address = outputAddress(output);
  if (!address) {
    throw createPreflightError('Broadcast preflight requires a standard-address previous output', 'unsupported_script', {
      reason: 'unsupported_previous_output_script',
      outpoint: outpointKey(input),
      scriptPubKey: output.scriptPubKey.hex,
    });
  }

  return {
    ...input,
    address,
    valueSats: normalizeOutputValueSats(output, input),
  };
};

const resolvePrevouts = (
  inputs: BroadcastInput[],
  previousTransactions: Map<string, TransactionDetails>,
): ResolvedPrevout[] => inputs.map(input => resolvePrevout(input, previousTransactions));

const fetchUnspentByAddress = async (
  client: PreflightClient,
  prevouts: ResolvedPrevout[],
) => {
  try {
    return await client.getAddressUTXOsBatch([...new Set(prevouts.map(prevout => prevout.address))]);
  } catch (error) {
    throw createPreflightError('Broadcast preflight could not fetch address UTXOs', 'node_preflight_unavailable', {
      error: getErrorMessage(error),
    });
  }
};

const assertPrevoutStillUnspent = (
  prevout: ResolvedPrevout,
  unspentByAddress: Awaited<ReturnType<typeof fetchUnspentByAddress>>,
): void => {
  const utxos = unspentByAddress.get(prevout.address);
  if (!utxos) {
    throw createPreflightError('Broadcast preflight received incomplete UTXO evidence', 'node_preflight_unavailable', {
      reason: 'missing_address_utxo_result',
      address: prevout.address,
    });
  }

  const match = utxos.find(utxo => utxo.tx_hash === prevout.txid && utxo.tx_pos === prevout.vout);
  if (!match) {
    throw createPreflightError('Broadcast preflight rejected stale or spent input', 'node_preflight_rejected', {
      reason: 'stale_or_spent_input',
      outpoint: outpointKey(prevout),
    });
  }

  if (match.value !== prevout.valueSats) {
    throw createPreflightError('Broadcast preflight rejected mismatched previous output value', 'node_preflight_rejected', {
      reason: 'prevout_value_mismatch',
      outpoint: outpointKey(prevout),
      expectedValueSats: prevout.valueSats,
      nodeValueSats: match.value,
    });
  }
};

const assertPrevoutsStillUnspent = async (
  client: PreflightClient,
  prevouts: ResolvedPrevout[],
): Promise<void> => {
  const unspentByAddress = await fetchUnspentByAddress(client, prevouts);
  for (const prevout of prevouts) {
    assertPrevoutStillUnspent(prevout, unspentByAddress);
  }
};

export async function verifyElectrumBroadcastPreflight(
  client: PreflightClient,
  rawTx: string,
): Promise<ElectrumBroadcastPreflightResult> {
  const parsed = parseRawTransactionInputs(rawTx);
  assertSpendableInputs(parsed.inputs);
  assertUniqueInputs(parsed.inputs);

  const previousTransactions = await fetchPreviousTransactions(client, parsed.inputs);
  const prevouts = resolvePrevouts(parsed.inputs, previousTransactions);
  await assertPrevoutsStillUnspent(client, prevouts);

  return {
    txid: parsed.txid,
    inputCount: parsed.inputs.length,
    checkedOutpoints: parsed.inputs.map(outpointKey),
  };
}

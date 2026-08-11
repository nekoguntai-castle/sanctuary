import * as bitcoin from 'bitcoinjs-lib';
import { ConflictError, InvalidInputError } from '../../../errors/ApiError';
import { findByOutpointsForWallet } from '../../../repositories/utxoRepository';
import { getNodeClient } from '../nodeClient';
import type { BitcoinNetwork } from '../networks';
import type { SigningIntentInputRole, SigningIntentPrevout } from './types';

type Outpoint = { txid: string; vout: number };
type WalletUtxo = Awaited<ReturnType<typeof findByOutpointsForWallet>>[number];

const outpointKey = ({ txid, vout }: Outpoint): string => `${txid}:${vout}`;

const invalidPrevout = (
  message: string,
  index: number,
  reason: string,
  details: Record<string, unknown> = {},
): InvalidInputError => new InvalidInputError(message, `inputs.${index}`, {
  reason,
  inputIndex: index,
  ...details,
});

const getPsbtOutpoint = (psbt: bitcoin.Psbt, index: number): Outpoint => {
  const input = psbt.txInputs[index];
  return {
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  };
};

const parseFullPreviousTransaction = (
  bytes: Buffer,
  outpoint: Outpoint,
  index: number,
): bitcoin.Transaction => {
  let transaction: bitcoin.Transaction;
  try {
    transaction = bitcoin.Transaction.fromBuffer(bytes);
  } catch {
    throw invalidPrevout('Previous transaction is malformed', index, 'malformed_previous_transaction');
  }
  if (transaction.getId() !== outpoint.txid) {
    throw invalidPrevout('Previous transaction id does not match the spent outpoint', index, 'previous_txid_mismatch', {
      expectedTxid: outpoint.txid,
      actualTxid: transaction.getId(),
    });
  }
  return transaction;
};

const parseCanonicalNodeTransaction = (
  hex: string,
  outpoint: Outpoint,
  index: number,
): bitcoin.Transaction => {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw invalidPrevout('Previous transaction is malformed', index, 'malformed_previous_transaction');
  }
  const transaction = parseFullPreviousTransaction(Buffer.from(hex, 'hex'), outpoint, index);
  /* v8 ignore next -- strict even full-hex parsing round-trips by construction in bitcoinjs */
  if (transaction.toHex() !== hex.toLowerCase()) {
    throw invalidPrevout('Previous transaction is malformed', index, 'malformed_previous_transaction');
  }
  return transaction;
};

const outputAt = (
  transaction: bitcoin.Transaction,
  outpoint: Outpoint,
  index: number,
): bitcoin.Transaction['outs'][number] => {
  const output = transaction.outs[outpoint.vout];
  if (!output) {
    throw invalidPrevout('Previous transaction output does not exist', index, 'missing_previous_output', {
      outpoint: outpointKey(outpoint),
    });
  }
  return output;
};

const assertOutputsEqual = (
  expected: bitcoin.Transaction['outs'][number],
  actual: bitcoin.Transaction['outs'][number],
  index: number,
  reason: string,
): void => {
  const amountMatches = BigInt(expected.value) === BigInt(actual.value);
  const scriptMatches = Buffer.from(expected.script).equals(Buffer.from(actual.script));
  if (amountMatches && scriptMatches) return;
  throw invalidPrevout('Previous output amount or script does not match', index, reason, {
    expectedAmountSats: expected.value.toString(),
    actualAmountSats: actual.value.toString(),
    expectedScriptPubKeyHex: Buffer.from(expected.script).toString('hex'),
    actualScriptPubKeyHex: Buffer.from(actual.script).toString('hex'),
  });
};

const resolvePsbtPrevout = (
  psbt: bitcoin.Psbt,
  index: number,
  outpoint: Outpoint,
): bitcoin.Transaction['outs'][number] => {
  const input = psbt.data.inputs[index];
  const witnessOutput = input.witnessUtxo;
  let nonWitnessOutput: bitcoin.Transaction['outs'][number] | undefined;
  if (input.nonWitnessUtxo) {
    const transaction = parseFullPreviousTransaction(Buffer.from(input.nonWitnessUtxo), outpoint, index);
    nonWitnessOutput = outputAt(transaction, outpoint, index);
  }
  if (witnessOutput && nonWitnessOutput) {
    assertOutputsEqual(witnessOutput, nonWitnessOutput, index, 'psbt_prevout_mismatch');
  }
  const output = witnessOutput ?? nonWitnessOutput;
  if (!output) {
    throw invalidPrevout('PSBT input is missing previous-output evidence', index, 'missing_witness_data');
  }
  return output;
};

const assertWalletUtxoState = (
  utxo: WalletUtxo | undefined,
  outpoint: Outpoint,
  index: number,
  allowedDraftId?: string,
  allowSpent = false,
): WalletUtxo => {
  if (!utxo) {
    throw invalidPrevout('Signing intent spends an input not controlled by the wallet', index, 'non_wallet_input', {
      outpoint: outpointKey(outpoint),
    });
  }
  if (utxo.spent && !allowSpent) {
    throw invalidPrevout('Signing intent spends an already-spent input', index, 'stale_utxo');
  }
  if (utxo.frozen) {
    throw invalidPrevout('Signing intent spends a frozen input', index, 'frozen_utxo');
  }
  const lockId = utxo.draftLock?.draftId;
  if (lockId && lockId !== allowedDraftId) {
    throw new ConflictError('Signing intent spends an input locked by another draft', undefined, {
      reason: 'locked_utxo',
      outpoint: outpointKey(outpoint),
      draftId: lockId,
    });
  }
  return utxo;
};

const walletOutput = (utxo: WalletUtxo): bitcoin.Transaction['outs'][number] => ({
  value: BigInt(utxo.amount),
  script: Buffer.from(utxo.scriptPubKey, 'hex'),
});

const fetchNodeTransactions = async (
  network: BitcoinNetwork,
  outpoints: Outpoint[],
): Promise<Map<string, { hex: string }>> => {
  const client = await getNodeClient(network);
  try {
    return await client.getTransactionsBatch([...new Set(outpoints.map(({ txid }) => txid))], true);
  } catch {
    throw new InvalidInputError('Could not authenticate previous transactions', 'inputs', {
      reason: 'node_preflight_unavailable',
    });
  }
};

const parseNodePrevout = (
  nodeTransaction: { hex: string } | undefined,
  outpoint: Outpoint,
  index: number,
): bitcoin.Transaction['outs'][number] => {
  if (!nodeTransaction?.hex) {
    throw invalidPrevout('Full previous transaction is unavailable', index, 'missing_previous_transaction', {
      txid: outpoint.txid,
    });
  }
  const transaction = parseCanonicalNodeTransaction(nodeTransaction.hex, outpoint, index);
  return outputAt(transaction, outpoint, index);
};

const assertAuthenticatedReplacement = (
  replacementTxid: string | undefined,
  nodeTransactions: Map<string, { hex: string }>,
  outpoints: Outpoint[],
): boolean => {
  if (!replacementTxid) return false;
  const record = nodeTransactions.get(replacementTxid);
  if (!record?.hex) {
    throw new InvalidInputError('Replaced transaction is unavailable', 'replacementTxid', {
      reason: 'missing_previous_transaction',
    });
  }
  const transaction = parseCanonicalNodeTransaction(
    record.hex,
    { txid: replacementTxid, vout: 0 },
    0,
  );
  if (!transaction.ins.some(input => input.sequence < 0xfffffffe)) {
    throw new InvalidInputError('Original transaction does not signal replacement', 'replacementTxid', {
      reason: 'stale_intent',
    });
  }
  const originalOutpoints = transaction.ins.map(input => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  }));
  if (originalOutpoints.length !== outpoints.length
    || originalOutpoints.some((outpoint, index) => outpointKey(outpoint) !== outpointKey(outpoints[index]))) {
    throw new InvalidInputError('Replacement inputs do not match the original transaction', 'replacementTxid', {
      reason: 'metadata_mismatch',
    });
  }
  return true;
};

export const authenticateIntentPrevouts = async (
  walletId: string,
  network: BitcoinNetwork,
  psbt: bitcoin.Psbt,
  roles: SigningIntentInputRole[],
  allowedDraftId?: string,
  replacementTxid?: string,
): Promise<SigningIntentPrevout[]> => {
  if (roles.length !== psbt.txInputs.length) {
    throw new InvalidInputError('Input ownership evidence is incomplete', 'inputRoles', {
      reason: 'non_wallet_input',
    });
  }
  const outpoints = psbt.txInputs.map((_, index) => getPsbtOutpoint(psbt, index));
  const [walletUtxos, nodeTransactions] = await Promise.all([
    findByOutpointsForWallet(walletId, outpoints),
    fetchNodeTransactions(network, replacementTxid
      ? [...outpoints, { txid: replacementTxid, vout: 0 }]
      : outpoints),
  ]);
  const walletByOutpoint = new Map(walletUtxos.map(utxo => [outpointKey(utxo), utxo]));
  const authenticatedReplacement = assertAuthenticatedReplacement(replacementTxid, nodeTransactions, outpoints);

  return outpoints.map((outpoint, index) => {
    const psbtOutput = resolvePsbtPrevout(psbt, index, outpoint);
    const nodeOutput = parseNodePrevout(nodeTransactions.get(outpoint.txid), outpoint, index);
    assertOutputsEqual(psbtOutput, nodeOutput, index, 'node_prevout_mismatch');

    if (roles[index] === 'wallet') {
      const utxo = assertWalletUtxoState(
        walletByOutpoint.get(outpointKey(outpoint)),
        outpoint,
        index,
        allowedDraftId,
        authenticatedReplacement,
      );
      assertOutputsEqual(psbtOutput, walletOutput(utxo), index, 'wallet_prevout_mismatch');
    }

    return {
      amountSats: BigInt(psbtOutput.value).toString(),
      scriptPubKeyHex: Buffer.from(psbtOutput.script).toString('hex'),
      role: roles[index],
    };
  });
};

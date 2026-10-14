/**
 * What an authenticated signing intent spends, derived only from its stored
 * snapshot and the wallet's own addresses — never from client-reported
 * recipient/amount. Shared by the broadcast route's canonical metadata and
 * the vault-policy evaluation of minted intents (draft creation, create-route
 * echo, payjoin attempt), so every policy decision sees the same spend.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { InvalidInputError } from '../../../errors/ApiError';
import { addressRepository } from '../../../repositories/addressRepository';
import { getNetwork } from '../utils';
import type { BitcoinNetwork } from '../networks';
import type { TransactionInputMetadata, TransactionOutputMetadata } from '../transactions/types';
import type { SigningIntentSnapshot } from './types';

export interface IntentSpend {
  /** Snapshot inputs with decoded prevout address and amount (txid/vout are the spent outpoints). */
  inputs: TransactionInputMetadata[];
  outputs: TransactionOutputMetadata[];
  /** Paid outputs to addresses outside the wallet. */
  externalOutputs: Array<{ address: string; amount: number }>;
  /** Sum of the external outputs. */
  amount: number;
  /** The txid this intent replaces (RBF), from the authenticated snapshot. */
  replacementTxid?: string;
}

const decodeAddress = (scriptHex: string, network: BitcoinNetwork): string => {
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptHex, 'hex'), getNetwork(network));
  } catch {
    return '';
  }
};

const safeIntentSats = (value: string, field: string): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new InvalidInputError('Signing intent amount is invalid', field, {
      reason: 'unknown_input_value',
    });
  }
  return amount;
};

export const deriveIntentSpend = async (
  walletId: string,
  network: BitcoinNetwork,
  snapshot: SigningIntentSnapshot,
): Promise<IntentSpend> => {
  const walletAddresses = new Set(await addressRepository.findAddressStrings(walletId));
  const inputs = snapshot.transaction.inputs.map((input, index) => ({
    txid: input.txid,
    vout: input.vout,
    address: decodeAddress(input.prevout.scriptPubKeyHex, network),
    amount: safeIntentSats(input.prevout.amountSats, `inputs.${index}.amountSats`),
  }));
  const outputs = snapshot.transaction.outputs.map((output, index) => {
    const address = decodeAddress(output.scriptPubKeyHex, network);
    const amount = safeIntentSats(output.amountSats, `outputs.${index}.amountSats`);
    const isOurs = address.length > 0 && walletAddresses.has(address);
    return {
      address,
      amount,
      outputType: isOurs ? 'change' as const : address ? 'recipient' as const : 'unknown' as const,
      isOurs,
      scriptPubKey: output.scriptPubKeyHex,
    };
  });
  // A paid output with no decodable address would be invisible to policy
  // evaluation, so it fails closed rather than being left out of the spend.
  const paidUnknown = outputs.find(output => !output.address && output.amount > 0);
  if (paidUnknown) {
    throw new InvalidInputError('Paid output uses an unsupported script', 'outputs', {
      reason: 'unsupported_script',
      scriptPubKey: paidUnknown.scriptPubKey,
    });
  }
  const externalOutputs = outputs
    .filter(output => !output.isOurs && output.address && output.amount > 0)
    .map(output => ({ address: output.address, amount: output.amount }));
  return {
    inputs,
    outputs,
    externalOutputs,
    amount: externalOutputs.reduce((sum, output) => sum + output.amount, 0),
    ...(snapshot.transaction.replacementTxid && { replacementTxid: snapshot.transaction.replacementTxid }),
  };
};

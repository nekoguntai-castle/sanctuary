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
  /**
   * The sender's net spend: the external outputs minus any payjoin receiver
   * (`payjoin_peer`) inputs, floored at 0. In BIP78 the receiver adds input C
   * and raises its output from P to P + C, so the sender pays P; when the
   * receiver also raises the fee by r out of C, its output is P + C - r and
   * the net spend is P - r (amount + fee is still the sender's real outflow).
   */
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
  /** The wallet's addresses, when the caller already loaded them; otherwise they are queried. */
  preloadedWalletAddresses?: ReadonlySet<string>,
): Promise<IntentSpend> => {
  const walletAddresses = preloadedWalletAddresses
    ?? new Set(await addressRepository.findAddressStrings(walletId));
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
  const externalTotal = externalOutputs.reduce((sum, output) => sum + output.amount, 0);
  const peerContribution = snapshot.transaction.inputs.reduce(
    (sum, input, index) => (input.prevout.role === 'payjoin_peer' ? sum + inputs[index].amount : sum),
    0,
  );
  return {
    inputs,
    outputs,
    externalOutputs,
    amount: Math.max(0, externalTotal - peerContribution),
    ...(snapshot.transaction.replacementTxid && { replacementTxid: snapshot.transaction.replacementTxid }),
  };
};

import * as bitcoin from 'bitcoinjs-lib';
import type { LegacyNetworkType } from '@sanctuary/shared/constants/bitcoin';
import { bitcoinJsNetworkName } from '../../../constants/bitcoinNetworks';
import type { TransactionOutput } from './types';

const getBitcoinJsNetwork = (network: LegacyNetworkType): bitcoin.Network => {
  const name = bitcoinJsNetworkName(network);
  if (name === 'testnet') return bitcoin.networks.testnet;
  if (name === 'regtest') return bitcoin.networks.regtest;
  return bitcoin.networks.bitcoin;
};

export const transactionOutputScriptHex = (output: TransactionOutput | undefined): string | undefined =>
  output?.scriptHex ?? output?.scriptPubKey?.hex;

export const transactionOutputAddress = (output: TransactionOutput | undefined): string | undefined =>
  output?.address ?? output?.scriptPubKey?.address ?? output?.scriptPubKey?.addresses?.[0];

/** Decode compact authenticated script evidence only at consumers that need an address. */
export const transactionOutputAddressForNetwork = (
  output: TransactionOutput | undefined,
  network: LegacyNetworkType,
): string | undefined => {
  const explicit = transactionOutputAddress(output);
  if (explicit) return explicit;
  const scriptHex = transactionOutputScriptHex(output);
  if (!scriptHex) return undefined;
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptHex, 'hex'), getBitcoinJsNetwork(network));
  } catch {
    return undefined;
  }
};

type TransactionOutputAddressDecoder = (
  output: TransactionOutput | undefined,
  network: LegacyNetworkType,
) => string | undefined;

/** Bound repeated script decoding to one transaction without retaining attempt-wide evidence. */
export const createBoundedTransactionOutputAddressResolver = (
  network: LegacyNetworkType,
  maxEntries: number,
  decode: TransactionOutputAddressDecoder = transactionOutputAddressForNetwork,
): ((output: TransactionOutput | undefined) => string | undefined) => {
  const addressesByScript = new Map<string, string | null>();
  return output => {
    const explicit = transactionOutputAddress(output);
    if (explicit) return explicit;
    const scriptHex = transactionOutputScriptHex(output);
    if (!scriptHex) return undefined;
    if (addressesByScript.has(scriptHex)) return addressesByScript.get(scriptHex) ?? undefined;
    const address = decode(output, network);
    if (addressesByScript.size < maxEntries) addressesByScript.set(scriptHex, address ?? null);
    return address;
  };
};

export const transactionOutputAddresses = (output: TransactionOutput | undefined): string[] => {
  if (!output) return [];
  if (output.address) return [output.address];
  const addresses = output.scriptPubKey?.addresses ? [...output.scriptPubKey.addresses] : [];
  if (output.scriptPubKey?.address && !addresses.includes(output.scriptPubKey.address)) {
    addresses.push(output.scriptPubKey.address);
  }
  return addresses;
};

import type { TransactionOutput } from './types';

export const transactionOutputScriptHex = (output: TransactionOutput | undefined): string | undefined =>
  output?.scriptHex ?? output?.scriptPubKey?.hex;

export const transactionOutputAddress = (output: TransactionOutput | undefined): string | undefined =>
  output?.address ?? output?.scriptPubKey?.address ?? output?.scriptPubKey?.addresses?.[0];

export const transactionOutputAddresses = (output: TransactionOutput | undefined): string[] => {
  if (!output) return [];
  if (output.address) return [output.address];
  const addresses = output.scriptPubKey?.addresses ? [...output.scriptPubKey.addresses] : [];
  if (output.scriptPubKey?.address && !addresses.includes(output.scriptPubKey.address)) {
    addresses.push(output.scriptPubKey.address);
  }
  return addresses;
};

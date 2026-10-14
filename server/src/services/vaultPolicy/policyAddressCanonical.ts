/**
 * Policy address canonicalization
 *
 * Address-control lists are compared by exact string, so equivalent spellings
 * of one address (uppercase bech32, padding) would bypass a denylist or
 * wrongly block an allowlisted address. Stored entries and recipients are both
 * reduced to one canonical form before comparing.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { resolvePersistedBitcoinNetwork } from '../../constants/bitcoinNetworks';
import { addressToOutputScript, getNetwork } from '../bitcoin/utils';

const BECH32_HRP_PATTERN = /^(bc1|tb1|bcrt1)/i;

/**
 * Canonical form of an address for the given persisted wallet network.
 * Throws when the network is invalid or the address does not decode.
 */
export function canonicalizePolicyAddress(address: string, network: string): string {
  const resolved = resolvePersistedBitcoinNetwork(network);
  return bitcoin.address.fromOutputScript(
    addressToOutputScript(address.trim(), resolved),
    getNetwork(resolved),
  );
}

/** Canonical form, or null when the address does not decode for the network. */
export function tryCanonicalizePolicyAddress(address: string, network: string): string | null {
  try {
    return canonicalizePolicyAddress(address, network);
  } catch {
    return null;
  }
}

/** Trimmed value, lowercased only when it is bech32 (case-insensitive by spec). */
export function fallbackAddressForm(address: string): string {
  const trimmed = address.trim();
  return BECH32_HRP_PATTERN.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function isKnownNetwork(network?: string | null): network is string {
  if (!network) return false;
  try {
    resolvePersistedBitcoinNetwork(network);
    return true;
  } catch {
    return false;
  }
}

export interface PolicyAddressComparison {
  stored: Set<string>;
  recipients: string[];
  /** Stored entries that did not decode on a known network (legacy rows). */
  undecodableStored: string[];
}

/**
 * Reduce stored entries and recipients to one comparable form. With an unknown
 * wallet network nothing is decoded and both sides use the fallback form.
 */
export function buildPolicyAddressComparison(
  storedEntries: string[],
  recipients: string[],
  network?: string | null,
): PolicyAddressComparison {
  const knownNetwork = isKnownNetwork(network) ? network : null;
  const canonicalOf = (address: string): string | null => (
    knownNetwork ? tryCanonicalizePolicyAddress(address, knownNetwork) : null
  );

  const stored = new Set<string>();
  const undecodableStored: string[] = [];
  for (const entry of storedEntries) {
    const canonical = canonicalOf(entry);
    if (canonical === null && knownNetwork) undecodableStored.push(entry);
    stored.add(canonical ?? fallbackAddressForm(entry));
  }

  return {
    stored,
    recipients: recipients.map((address) => canonicalOf(address) ?? fallbackAddressForm(address)),
    undecodableStored,
  };
}

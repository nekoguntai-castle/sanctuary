import { describe, expect, it } from 'vitest';
import {
  BITCOIN_NETWORKS,
  SATS_PER_BTC,
  isNetworkType,
  isTestnetFamilyNetwork,
  normalizeLegacyNetworkType,
} from '@sanctuary/shared/constants/bitcoin';

describe('shared Bitcoin constants', () => {
  it('defines supported canonical network names', () => {
    expect(SATS_PER_BTC).toBe(100_000_000);
    expect(BITCOIN_NETWORKS).toEqual(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest']);
  });

  it('guards canonical networks', () => {
    expect(isNetworkType('mainnet')).toBe(true);
    expect(isNetworkType('testnet4')).toBe(true);
    expect(isNetworkType('regtest')).toBe(true);
    expect(isNetworkType('testnet')).toBe(false);
    expect(isNetworkType(null)).toBe(false);
  });

  it('normalizes legacy testnet names and invalid values', () => {
    expect(normalizeLegacyNetworkType('testnet')).toBe('testnet3');
    expect(normalizeLegacyNetworkType('testnet4')).toBe('testnet4');
    expect(normalizeLegacyNetworkType('unknown', 'signet')).toBe('signet');
    expect(normalizeLegacyNetworkType(undefined)).toBe('mainnet');
  });

  it('identifies testnet-family networks', () => {
    expect(isTestnetFamilyNetwork('testnet')).toBe(true);
    expect(isTestnetFamilyNetwork('testnet3')).toBe(true);
    expect(isTestnetFamilyNetwork('testnet4')).toBe(true);
    expect(isTestnetFamilyNetwork('signet')).toBe(true);
    expect(isTestnetFamilyNetwork('regtest')).toBe(true);
    expect(isTestnetFamilyNetwork('mainnet')).toBe(false);
    expect(isTestnetFamilyNetwork(undefined)).toBe(false);
  });
});

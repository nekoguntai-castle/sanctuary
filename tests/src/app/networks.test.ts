import { describe, expect, it } from 'vitest';
import {
  coinTypeForNetwork,
  countByNetwork,
  filterByNetwork,
  formatNetworkTitle,
  isMainnetNetwork,
  isTabNetwork,
  networksShareCoinType,
  suppressFiatForNetwork,
  toTabNetwork,
} from '../../../src/app/networks';

describe('network helpers', () => {
  const wallets = [
    { id: 'main', network: 'mainnet' },
    { id: 'missing' },
    { id: 'test', network: 'testnet' },
    { id: 'signet', network: 'signet' },
    { id: 'unknown', network: 'regtest' },
  ];

  it('normalizes tab networks and titles', () => {
    expect(isTabNetwork('mainnet')).toBe(true);
    expect(isTabNetwork('regtest')).toBe(false);
    expect(toTabNetwork('signet')).toBe('signet');
    expect(toTabNetwork('regtest', 'testnet')).toBe('testnet');
    expect(formatNetworkTitle('testnet')).toBe('Testnet');
  });

  it('classifies mainnet, fiat suppression, and coin types', () => {
    expect(isMainnetNetwork(undefined)).toBe(true);
    expect(isMainnetNetwork(null)).toBe(true);
    expect(isMainnetNetwork('testnet')).toBe(false);
    expect(suppressFiatForNetwork('mainnet')).toBe(false);
    expect(suppressFiatForNetwork('testnet')).toBe(true);
    expect(suppressFiatForNetwork('signet')).toBe(true);
    expect(coinTypeForNetwork(undefined)).toBe(0);
    expect(coinTypeForNetwork('mainnet')).toBe(0);
    expect(coinTypeForNetwork('signet')).toBe(1);
    expect(networksShareCoinType('testnet', 'signet')).toBe(true);
    expect(networksShareCoinType('mainnet', 'testnet')).toBe(false);
  });

  it('counts and filters items by tab network', () => {
    expect(countByNetwork(wallets)).toEqual({
      mainnet: 3,
      testnet: 1,
      signet: 1,
    });
    expect(filterByNetwork(wallets, 'mainnet').map(wallet => wallet.id)).toEqual([
      'main',
      'missing',
      'unknown',
    ]);
    expect(filterByNetwork(wallets, 'signet').map(wallet => wallet.id)).toEqual(['signet']);
  });
});

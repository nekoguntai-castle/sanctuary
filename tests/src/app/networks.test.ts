import { describe, expect, it } from 'vitest';
import {
  coinTypeForNetwork,
  countByNetwork,
  filterByNetwork,
  formatNetworkTitle,
  getNetworkColorClass,
  isMainnetNetwork,
  isTabNetwork,
  networkConfigs,
  networksShareCoinType,
  suppressFiatForNetwork,
  toTabNetwork,
} from '../../../src/app/networks';

describe('network helpers', () => {
  const wallets = [
    { id: 'main', network: 'mainnet' },
    { id: 'missing' },
    { id: 'legacy-test', network: 'testnet' },
    { id: 'test3', network: 'testnet3' },
    { id: 'test4', network: 'testnet4' },
    { id: 'signet', network: 'signet' },
    { id: 'unknown', network: 'regtest' },
  ];

  it('normalizes tab networks and titles', () => {
    expect(isTabNetwork('mainnet')).toBe(true);
    expect(isTabNetwork('testnet3')).toBe(true);
    expect(isTabNetwork('testnet4')).toBe(true);
    expect(isTabNetwork('testnet')).toBe(false);
    expect(isTabNetwork('regtest')).toBe(false);
    expect(toTabNetwork('testnet')).toBe('testnet3');
    expect(toTabNetwork('signet')).toBe('signet');
    expect(toTabNetwork('regtest', 'testnet4')).toBe('testnet4');
    expect(formatNetworkTitle('testnet3')).toBe('Testnet3');
    expect(formatNetworkTitle('testnet4')).toBe('Testnet4');
  });

  it('assigns unique visible colors to each tab network', () => {
    expect(new Set(Object.values(networkConfigs).map(config => config.dotColor)).size).toBe(4);
    expect(networkConfigs.testnet3.dotColor).toBe('bg-testnet-500');
    expect(networkConfigs.testnet4.dotColor).toBe('bg-teal-500');
    expect(getNetworkColorClass('testnet3', 'activeTab')).toContain('text-testnet-600');
    expect(getNetworkColorClass('testnet4', 'activeTab')).toContain('text-teal-600');
  });

  it('classifies mainnet, fiat suppression, and coin types', () => {
    expect(isMainnetNetwork(undefined)).toBe(true);
    expect(isMainnetNetwork(null)).toBe(true);
    expect(isMainnetNetwork('testnet')).toBe(false);
    expect(suppressFiatForNetwork('mainnet')).toBe(false);
    expect(suppressFiatForNetwork('testnet3')).toBe(true);
    expect(suppressFiatForNetwork('testnet4')).toBe(true);
    expect(suppressFiatForNetwork('signet')).toBe(true);
    expect(coinTypeForNetwork(undefined)).toBe(0);
    expect(coinTypeForNetwork('mainnet')).toBe(0);
    expect(coinTypeForNetwork('testnet4')).toBe(1);
    expect(coinTypeForNetwork('signet')).toBe(1);
    expect(networksShareCoinType('testnet3', 'testnet4')).toBe(true);
    expect(networksShareCoinType('testnet', 'signet')).toBe(true);
    expect(networksShareCoinType('mainnet', 'testnet3')).toBe(false);
  });

  it('counts and filters items by tab network', () => {
    expect(countByNetwork(wallets)).toEqual({
      mainnet: 3,
      testnet3: 2,
      testnet4: 1,
      signet: 1,
    });
    expect(filterByNetwork(wallets, 'mainnet').map(wallet => wallet.id)).toEqual([
      'main',
      'missing',
      'unknown',
    ]);
    expect(filterByNetwork(wallets, 'testnet3').map(wallet => wallet.id)).toEqual([
      'legacy-test',
      'test3',
    ]);
    expect(filterByNetwork(wallets, 'testnet4').map(wallet => wallet.id)).toEqual(['test4']);
    expect(filterByNetwork(wallets, 'signet').map(wallet => wallet.id)).toEqual(['signet']);
  });
});

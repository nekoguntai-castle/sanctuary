import { describe, expect, it } from 'vitest';
import {
  attachPendingData,
  buildPendingByWallet,
  countWalletsByNetwork,
  filterWalletsByNetwork,
  formatNetworkTitle,
  isTabNetwork,
  resolveInitialNetwork,
  sortWallets,
  totalWalletBalance,
  walletIds,
} from '../../../src/components/WalletList/walletListData';

const wallets = [
  { id: 'alpha', name: 'Alpha', type: 'single_sig', balance: 300, network: 'mainnet', deviceCount: 2 },
  { id: 'bravo', name: 'Bravo', type: 'multi_sig', balance: 100, network: 'testnet3', deviceCount: 5 },
  { id: 'charlie', name: 'Charlie', type: 'single_sig', balance: 200, network: 'signet' },
] as any[];

describe('walletListData', () => {
  it('resolves URL networks and display titles', () => {
    expect(isTabNetwork(null)).toBe(false);
    expect(isTabNetwork('mainnet')).toBe(true);
    expect(resolveInitialNetwork('testnet')).toBe('testnet3');
    expect(resolveInitialNetwork('testnet4')).toBe('testnet4');
    expect(resolveInitialNetwork('signet')).toBe('signet');
    expect(resolveInitialNetwork('regtest')).toBe('mainnet');
    expect(formatNetworkTitle('testnet3')).toBe('Testnet3');
  });

  it('filters, counts, totals, and maps wallet ids by network', () => {
    expect(filterWalletsByNetwork(wallets, 'mainnet').map(wallet => wallet.id)).toEqual(['alpha']);
    expect(countWalletsByNetwork(wallets)).toEqual({
      mainnet: 1,
      testnet3: 1,
      testnet4: 0,
      signet: 1,
    });
    expect(totalWalletBalance(wallets)).toBe(600);
    expect(walletIds(wallets)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('sorts every wallet column and keeps empty arrays stable', () => {
    expect(sortWallets([], 'name', 'asc')).toEqual([]);
    expect(sortWallets(wallets, 'name', 'asc').map(wallet => wallet.id)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
    expect(sortWallets(wallets, 'type', 'desc').map(wallet => wallet.id)[0]).toBe('alpha');
    expect(sortWallets(wallets, 'devices', 'asc').map(wallet => wallet.id)).toEqual([
      'charlie',
      'alpha',
      'bravo',
    ]);
    expect(sortWallets(wallets, 'network', 'asc').map(wallet => wallet.id)).toEqual([
      'alpha',
      'charlie',
      'bravo',
    ]);
    expect(sortWallets(wallets, 'balance', 'desc').map(wallet => wallet.id)).toEqual([
      'alpha',
      'charlie',
      'bravo',
    ]);
    expect(sortWallets(wallets, 'unknown' as any, 'asc').map(wallet => wallet.id)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
  });

  it('builds and attaches pending wallet summaries', () => {
    const pendingByWallet = buildPendingByWallet([
      { walletId: 'alpha', amount: 50, type: 'received' },
      { walletId: 'alpha', amount: -25, type: 'sent' },
    ]);

    expect(pendingByWallet.alpha).toEqual({
      net: 25,
      count: 2,
      hasIncoming: true,
      hasOutgoing: true,
    });
    expect(attachPendingData(wallets, pendingByWallet)[0].pendingData).toBe(pendingByWallet.alpha);
  });
});

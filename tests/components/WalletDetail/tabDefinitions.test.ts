import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALLET_DETAIL_TAB,
  WALLET_DETAIL_TAB_IDS,
  canShowWalletDetailTab,
  getWalletDetailTabDefinition,
  getWalletDetailTabs,
  isWalletDetailTab,
  resolveWalletDetailTab,
  walletDetailTabDefinitions,
} from '../../../components/WalletDetail/tabDefinitions';

describe('wallet detail tab definitions', () => {
  it('keeps tab order, labels, and default tab in the registry', () => {
    expect(DEFAULT_WALLET_DETAIL_TAB).toBe('tx');
    expect(WALLET_DETAIL_TAB_IDS).toEqual([
      'tx',
      'utxo',
      'addresses',
      'drafts',
      'stats',
      'access',
      'settings',
      'log',
    ]);
    expect(walletDetailTabDefinitions.map((tab) => tab.label)).toEqual([
      'Transactions',
      'UTXOs',
      'Addresses',
      'Drafts',
      'Stats',
      'Access',
      'Settings',
      'Log',
    ]);
  });

  it('applies viewer, editor, and owner visibility rules', () => {
    expect(getWalletDetailTabs('viewer').map((tab) => tab.id)).toEqual([
      'tx',
      'utxo',
      'addresses',
      'stats',
      'settings',
      'log',
    ]);
    expect(getWalletDetailTabs('signer').map((tab) => tab.id)).toEqual([
      'tx',
      'utxo',
      'addresses',
      'drafts',
      'stats',
      'settings',
      'log',
    ]);
    expect(getWalletDetailTabs('approver').map((tab) => tab.id)).toEqual([
      'tx',
      'utxo',
      'addresses',
      'stats',
      'settings',
      'log',
    ]);
    expect(getWalletDetailTabs('owner').map((tab) => tab.id)).toEqual(WALLET_DETAIL_TAB_IDS);
    expect(canShowWalletDetailTab('drafts', 'viewer')).toBe(false);
    expect(canShowWalletDetailTab('drafts', 'signer')).toBe(true);
    expect(canShowWalletDetailTab('drafts', 'approver')).toBe(false);
    expect(canShowWalletDetailTab('access', 'signer')).toBe(false);
    expect(canShowWalletDetailTab('access', 'owner')).toBe(true);
  });

  it('validates and resolves router-provided tab values', () => {
    expect(isWalletDetailTab('stats')).toBe(true);
    expect(isWalletDetailTab('missing')).toBe(false);
    expect(resolveWalletDetailTab('stats', 'viewer')).toBe('stats');
    expect(resolveWalletDetailTab('access', 'viewer')).toBe('tx');
    expect(resolveWalletDetailTab('drafts', 'viewer', 'settings')).toBe('settings');
    expect(resolveWalletDetailTab('unknown', 'owner')).toBe('tx');
  });

  it('throws when a requested tab definition is missing', () => {
    expect(() => getWalletDetailTabDefinition('missing' as any)).toThrow(
      'Missing wallet detail tab definition: missing'
    );
  });
});

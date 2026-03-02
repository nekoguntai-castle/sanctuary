import { describe, expect, it } from 'vitest';
import { WalletType } from '../../../../types';
import {
  formatDevicesForWallet,
  formatWalletFromApi,
} from '../../../../components/WalletDetail/hooks/walletDataFormatters';

describe('walletDataFormatters', () => {
  it('formats API wallet with multisig quorum mapping when quorum and totalSigners exist', () => {
    const formatted = formatWalletFromApi(
      {
        id: 'wallet-1',
        name: 'Vault',
        type: 'multi_sig',
        network: 'mainnet',
        balance: 12345,
        scriptType: 'native_segwit',
        descriptor: "wsh(sortedmulti(2,...))",
        fingerprint: 'abcd1234',
        quorum: 2,
        totalSigners: 3,
      } as any,
      'user-1'
    );

    expect(formatted.type).toBe(WalletType.MULTI_SIG);
    expect(formatted.quorum).toEqual({ m: 2, n: 3 });
    expect(formatted.ownerId).toBe('user-1');
    expect(formatted.derivationPath).toBe("wsh(sortedmulti(2,...))");
  });

  it('falls back wallet quorum to 1-of-1 when quorum metadata is incomplete', () => {
    const formatted = formatWalletFromApi(
      {
        id: 'wallet-2',
        name: 'Single',
        type: 'single_sig',
        network: 'testnet',
        balance: 0,
        scriptType: 'native_segwit',
        descriptor: null,
        fingerprint: null,
        quorum: 2,
        totalSigners: null,
      } as any,
      'user-2'
    );

    expect(formatted.type).toBe(WalletType.SINGLE_SIG);
    expect(formatted.quorum).toEqual({ m: 1, n: 1 });
    expect(formatted.derivationPath).toBe('');
    expect(formatted.fingerprint).toBe('');
  });

  it('formats wallet devices using exact account matches and account-missing fallbacks', () => {
    const apiWallet = {
      id: 'wallet-1',
      type: 'single_sig',
      scriptType: 'native_segwit',
    } as any;

    const formatted = formatDevicesForWallet(
      [
        {
          id: 'device-match',
          type: 'ledger',
          label: 'Match Device',
          fingerprint: 'aaaa1111',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-match',
          accounts: [
            {
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/1'",
              xpub: 'xpub-account-match',
            },
          ],
          wallets: [{ wallet: { id: 'wallet-1' } }],
        },
        {
          id: 'device-missing-account',
          type: 'ledger',
          label: 'Missing Account Device',
          fingerprint: 'bbbb2222',
          derivationPath: '',
          xpub: 'xpub-fallback',
          accounts: undefined,
          wallets: [{ wallet: { id: 'wallet-1' } }],
        },
        {
          id: 'device-other-wallet',
          type: 'ledger',
          label: 'Other Wallet Device',
          fingerprint: 'cccc3333',
          wallets: [{ wallet: { id: 'wallet-other' } }],
        },
      ] as any,
      apiWallet,
      'wallet-1',
      'user-42'
    );

    expect(formatted).toHaveLength(2);

    const matched = formatted.find(d => d.id === 'device-match');
    expect(matched).toMatchObject({
      derivationPath: "m/84'/0'/1'",
      xpub: 'xpub-account-match',
      accountMissing: false,
      userId: 'user-42',
    });

    const missing = formatted.find(d => d.id === 'device-missing-account');
    expect(missing).toMatchObject({
      derivationPath: 'No matching account',
      xpub: 'xpub-fallback',
      accountMissing: true,
      userId: 'user-42',
    });
  });

  it('matches multisig accounts when wallet type is multi_sig', () => {
    const apiWallet = {
      id: 'wallet-ms',
      type: 'multi_sig',
      scriptType: 'native_segwit',
    } as any;

    const formatted = formatDevicesForWallet(
      [
        {
          id: 'device-ms',
          type: 'coldcard',
          label: 'Multisig Device',
          fingerprint: 'dddd4444',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub-device-default',
          accounts: [
            {
              purpose: 'multisig',
              scriptType: 'native_segwit',
              derivationPath: "m/48'/0'/1'/2'",
              xpub: 'xpub-multisig-match',
            },
          ],
          wallets: [{ wallet: { id: 'wallet-ms' } }],
        },
      ] as any,
      apiWallet,
      'wallet-ms',
      'user-99'
    );

    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toMatchObject({
      id: 'device-ms',
      derivationPath: "m/48'/0'/1'/2'",
      xpub: 'xpub-multisig-match',
      accountMissing: false,
      userId: 'user-99',
    });
  });
});

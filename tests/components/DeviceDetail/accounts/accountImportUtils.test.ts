import { describe,expect,it } from 'vitest';
import {
createSingleAccount,
parseFileContent,
processImportedAccounts,
} from '../../../../src/components/DeviceDetail/accounts/accountImportUtils';
import type { DeviceAccount } from '../../../../src/services/deviceParsers';

const makeParsedAccount = (overrides: Partial<DeviceAccount> = {}): DeviceAccount => ({
  purpose: 'single_sig',
  scriptType: 'native_segwit',
  derivationPath: "m/84'/0'/0'",
  xpub: 'xpub-default',
  ...overrides,
});

describe('accountImportUtils', () => {
  describe('processImportedAccounts', () => {
    it('rejects fingerprint mismatches (case-insensitive comparison)', () => {
      const result = processImportedAccounts(
        [makeParsedAccount()],
        'ABCD1234',
        {
          fingerprint: 'ffff0000',
          accounts: [],
        } as any
      );

      expect(result).toEqual({
        error: 'Fingerprint mismatch: imported ABCD1234 but device has ffff0000',
      });
    });

    it('returns conflict error when derivation path exists with different xpub', () => {
      const result = processImportedAccounts(
        [makeParsedAccount({ derivationPath: "m/84'/0'/0'", xpub: 'xpub-new' })],
        'abcd1234',
        {
          fingerprint: 'ABCD1234',
          accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }],
        } as any
      );

      expect(result).toEqual({
        error: '1 account(s) have conflicting xpubs - this may indicate a security issue',
      });
    });

    it('returns no-new-accounts error when all imported paths already exist', () => {
      const result = processImportedAccounts(
        [makeParsedAccount({ derivationPath: "m/84'/0'/0'", xpub: 'xpub-default' })],
        'abcd1234',
        {
          fingerprint: 'ABCD1234',
          accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-default' }],
        } as any
      );

      expect(result).toEqual({
        error: 'No new accounts to add - all derivation paths already exist on this device',
      });
    });

    it('returns new + matching accounts and handles devices with no existing accounts', () => {
      const imported = [
        makeParsedAccount({ derivationPath: "m/84'/0'/0'", xpub: 'xpub-match' }),
        makeParsedAccount({ derivationPath: "m/84'/0'/1'", xpub: 'xpub-new' }),
      ];

      const withExisting = processImportedAccounts(
        imported as any,
        'abcd1234',
        {
          fingerprint: 'ABCD1234',
          accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-match' }],
        } as any
      );

      expect(withExisting).toEqual({
        newAccounts: [imported[1]],
        matchingAccounts: [imported[0]],
      });

      const withoutExisting = processImportedAccounts(
        imported as any,
        '',
        {
          fingerprint: 'ABCD1234',
          accounts: undefined,
        } as any
      );

      expect(withoutExisting).toEqual({
        newAccounts: imported,
        matchingAccounts: [],
      });
    });
  });

  describe('parseFileContent', () => {
    it('returns null for null or structurally invalid parse results', () => {
      expect(parseFileContent(null)).toBeNull();
      expect(parseFileContent({})).toBeNull();
      expect(parseFileContent({ accounts: [] })).toBeNull();
    });

    it('returns multi-account payloads directly', () => {
      const accounts = [
        makeParsedAccount({ derivationPath: "m/84'/0'/0'", xpub: 'xpub-1' }),
        makeParsedAccount({ derivationPath: "m/84'/0'/1'", xpub: 'xpub-2' }),
      ];

      expect(
        parseFileContent({
          accounts: accounts as any,
          fingerprint: 'ff00aa11',
        })
      ).toEqual({
        accounts,
        fingerprint: 'ff00aa11',
      });

      expect(
        parseFileContent({
          accounts: accounts as any,
        })
      ).toEqual({
        accounts,
        fingerprint: '',
      });
    });

    it('converts single-xpub payloads into one parsed account', () => {
      expect(
        parseFileContent({
          xpub: 'xpub-single',
          derivationPath: "m/48'/0'/0'/1'",
          fingerprint: 'abcd',
        })
      ).toEqual({
        accounts: [
          {
            purpose: 'multisig',
            scriptType: 'nested_segwit',
            derivationPath: "m/48'/0'/0'/1'",
            xpub: 'xpub-single',
          },
        ],
        fingerprint: 'abcd',
      });

      expect(
        parseFileContent({
          xpub: 'xpub-no-fingerprint',
          derivationPath: "m/84'/0'/0'",
        })
      ).toEqual({
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub-no-fingerprint',
          },
        ],
        fingerprint: '',
      });
    });

    it('returns null when payload bypasses early guard but has no xpub and no valid account array', () => {
      expect(
        parseFileContent({
          accounts: { length: -1 } as any,
        } as any)
      ).toBeNull();
    });
  });

  describe('createSingleAccount', () => {
    it('maps script types for multisig native, multisig nested, and single-sig defaults', () => {
      expect(
        createSingleAccount({
          xpub: 'xpub-native',
          derivationPath: "m/48'/0'/0'/2'",
        })
      ).toEqual({
        purpose: 'multisig',
        scriptType: 'native_segwit',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: 'xpub-native',
      });

      expect(
        createSingleAccount({
          xpub: 'xpub-nested',
          derivationPath: "m/48'/0'/0'/1'",
        })
      ).toEqual({
        purpose: 'multisig',
        scriptType: 'nested_segwit',
        derivationPath: "m/48'/0'/0'/1'",
        xpub: 'xpub-nested',
      });

      expect(createSingleAccount({})).toEqual({
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: '',
        xpub: '',
      });
    });
  });
});

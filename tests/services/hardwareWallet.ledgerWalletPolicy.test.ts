import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockDefaultWalletPolicy, mockParseCanonicalAccountPath } = vi.hoisted(() => ({
  MockDefaultWalletPolicy: vi.fn(function MockDefaultWalletPolicy(
    this: { template?: string; keyInfo?: string },
    template: string,
    keyInfo: string,
  ) {
    this.template = template;
    this.keyInfo = keyInfo;
  }),
  mockParseCanonicalAccountPath: vi.fn(),
}));

vi.mock('@ledgerhq/ledger-bitcoin', () => ({ DefaultWalletPolicy: MockDefaultWalletPolicy }));
vi.mock('@sanctuary/shared/constants/walletPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sanctuary/shared/constants/walletPolicy')>();
  mockParseCanonicalAccountPath.mockImplementation(actual.parseCanonicalAccountPath);
  return { ...actual, parseCanonicalAccountPath: mockParseCanonicalAccountPath };
});

import {
  buildLedgerDefaultPolicy,
  requireLedgerAddressPath,
} from '../../src/services/hardwareWallet/adapters/ledger/walletPolicy';

function client(fingerprint = 'AABBCCDD', xpub = 'account-xpub') {
  return {
    getMasterFingerprint: vi.fn().mockResolvedValue(fingerprint),
    getExtendedPubkey: vi.fn().mockResolvedValue(xpub),
  };
}

describe('Ledger default wallet policy construction', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [44, 'pkh(@0/**)'],
    [49, 'sh(wpkh(@0/**))'],
    [84, 'wpkh(@0/**)'],
    [86, 'tr(@0/**)'],
  ] as const)('covers BIP%d on both coin families and accounts 0/7', async (purpose, template) => {
    for (const coinType of [0, 1]) {
      for (const account of [0, 7]) {
        const path = `m/${purpose}'/${coinType}'/${account}'`;
        const appClient = client('AABBCCDD', `xpub-${purpose}-${coinType}-${account}`);
        const result = await buildLedgerDefaultPolicy(appClient as never, path);
        expect(appClient.getExtendedPubkey).toHaveBeenCalledWith(path, false);
        expect(MockDefaultWalletPolicy).toHaveBeenLastCalledWith(
          template,
          `[aabbccdd/${purpose}'/${coinType}'/${account}']xpub-${purpose}-${coinType}-${account}`,
        );
        expect(result).toMatchObject({ accountPath: path, fingerprint: 'aabbccdd' });
      }
    }
  });

  it('rejects fingerprint, xpub, malformed path, and multisig path mismatches', async () => {
    await expect(buildLedgerDefaultPolicy(
      client() as never, "m/84'/0'/0'", 'deadbeef', 'account-xpub',
    )).rejects.toThrow(/fingerprint/);
    await expect(buildLedgerDefaultPolicy(
      client() as never, "m/84'/0'/0'", 'aabbccdd', 'wrong-xpub',
    )).rejects.toThrow(/account xpub/);
    await expect(buildLedgerDefaultPolicy(client('AABBCCDD', '') as never, "m/84'/0'/0'"))
      .rejects.toThrow(/empty account xpub/);
    await expect(buildLedgerDefaultPolicy(client() as never, "m/84'/0'/0'/0/0"))
      .rejects.toThrow(/canonical single-signature account path/);
    await expect(buildLedgerDefaultPolicy(client() as never, "m/48'/0'/0'/2'"))
      .rejects.toThrow(/canonical single-signature account path/);
  });

  it('fails closed if parsed policy data contains an unsupported script type', async () => {
    mockParseCanonicalAccountPath.mockReturnValueOnce({
      policy: { walletType: 'single_sig', scriptType: 'future_script' },
    });
    await expect(buildLedgerDefaultPolicy(client() as never, "m/84'/0'/0'"))
      .rejects.toThrow(/Unsupported Ledger wallet policy script type: future_script/);
  });

  it.each([
    ["m/44'/0'/0'/0/0", 0, 0],
    ["m/49'/1'/7'/0/19", 0, 19],
    ["m/84'/0'/7'/1/0", 1, 0],
    ["m/86'/1'/0'/1/19", 1, 19],
  ] as const)('parses canonical receive/change display path %s', (path, branch, index) => {
    expect(requireLedgerAddressPath(path)).toMatchObject({ path, branch, index });
  });

  it.each([
    "m/84'/0'/0'", "m/84'/0'/0'/2/0", "m/48'/0'/0'/2'/0/0", "m/84'/2'/0'/0/0",
  ])('rejects noncanonical display path %s', (path) => {
    expect(() => requireLedgerAddressPath(path)).toThrow(/canonical single-signature path/);
  });
});

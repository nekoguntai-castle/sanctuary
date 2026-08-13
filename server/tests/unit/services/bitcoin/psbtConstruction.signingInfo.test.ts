import { resolveWalletSigningInfo } from '../../../../src/services/bitcoin/transactions/psbtConstruction';

const { mockParseDescriptor } = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  addressRepository: {},
}));

vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  convertToStandardXpub: vi.fn((xpub: string) => xpub),
  parseDescriptor: mockParseDescriptor,
}));

vi.mock('../../../../src/services/bitcoin/transactions/helpers', () => ({
  getRawTransactionHex: vi.fn(),
}));

const immutableSigner = {
  signerBindingVersion: 1,
  signerIndex: 0,
  signerFingerprint: 'aabbccdd',
  signerXpub: 'tpub-test-account',
  signerDerivationPath: "m/86'/1'/0'",
  deviceAccountId: 'account-1',
  device: {
    id: 'device-1',
    fingerprint: 'aabbccdd',
    xpub: 'tpub-test-account',
  },
};

const wallet = (overrides: Record<string, unknown> = {}) => ({
  id: 'wallet-1',
  type: 'single_sig',
  network: 'testnet',
  scriptType: 'taproot',
  fingerprint: 'aabbccdd',
  descriptor: null,
  devices: [immutableSigner],
  ...overrides,
});

describe('resolveWalletSigningInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries the canonical Taproot script type with immutable signer evidence', () => {
    expect(resolveWalletSigningInfo(wallet())).toEqual({
      isMultisig: false,
      scriptType: 'taproot',
      masterFingerprint: Buffer.from('aabbccdd', 'hex'),
      accountXpub: 'tpub-test-account',
      accountPath: "m/86'/1'/0'",
    });
  });

  it.each([null, 'p2tr'])('rejects a missing or non-canonical script type: %s', scriptType => {
    expect(() => resolveWalletSigningInfo(wallet({ scriptType })))
      .toThrow('wallet script type is missing or unsupported');
  });

  it('keeps Taproot multisig blocked before descriptor parsing', () => {
    expect(() => resolveWalletSigningInfo(wallet({
      type: 'multi_sig',
      descriptor: 'tr(sortedmulti(...))',
    }))).toThrow('Taproot multisig is not supported');
    expect(mockParseDescriptor).not.toHaveBeenCalled();
  });

  it('continues to construct supported native SegWit multisig signing info', () => {
    mockParseDescriptor.mockReturnValue({
      type: 'wsh-sortedmulti',
      quorum: 2,
      keys: [{ fingerprint: 'aabbccdd', accountPath: "48'/1'/0'/2'", xpub: 'tpub-cosigner' }],
    });

    expect(resolveWalletSigningInfo(wallet({
      type: 'multi_sig',
      scriptType: 'native_segwit',
      descriptor: 'wsh(sortedmulti(...))',
    }))).toMatchObject({
      isMultisig: true,
      scriptType: 'native_segwit',
      multisigQuorum: 2,
      multisigScriptType: 'wsh-sortedmulti',
    });
  });
});

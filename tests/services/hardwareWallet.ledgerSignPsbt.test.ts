import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  MockDefaultWalletPolicy,
  mockValidate,
} = vi.hoisted(() => ({
  MockDefaultWalletPolicy: vi.fn(function MockDefaultWalletPolicy(
    this: { template?: string; keyInfo?: string },
    template: string,
    keyInfo: string,
  ) {
    this.template = template;
    this.keyInfo = keyInfo;
  }),
  mockValidate: vi.fn(),
}));

vi.mock('@ledgerhq/ledger-bitcoin', () => ({ DefaultWalletPolicy: MockDefaultWalletPolicy }));
vi.mock('../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: mockValidate,
}));
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { signPsbt } from '../../src/services/hardwareWallet/adapters/ledger/signPsbt';

const ACCOUNT_PATH = "m/84'/0'/7'";
const XPUB = 'xpub-wallet-selected';

type ValidatedOptions = {
  walletType?: 'single_sig' | 'multi_sig';
  scriptType?: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
  accountPath?: string;
  accountXpub?: string;
};

function makeValidated(options: ValidatedOptions = {}) {
  const accountPath = options.accountPath ?? ACCOUNT_PATH;
  const accountXpub = options.accountXpub ?? XPUB;
  const psbt = {
    updateInput: vi.fn(),
    finalizeAllInputs: vi.fn(),
    toBase64: vi.fn(() => 'signed-psbt'),
  };
  return {
    psbt,
    context: {
      walletType: options.walletType ?? 'single_sig',
      scriptType: options.scriptType ?? 'native_segwit',
      inputs: [{ inputIndex: 0 }],
    },
    connectedSigner: {
      accountPath,
      accountXpub,
    },
    changeOutputIndexes: [1],
    accountPath,
  };
}

function makeClient(options: { xpub?: string; signatures?: Array<[number, { pubkey: Uint8Array; signature: Uint8Array }]> } = {}) {
  return {
    getMasterFingerprint: vi.fn().mockResolvedValue('AABBCCDD'),
    getExtendedPubkey: vi.fn().mockResolvedValue(options.xpub ?? XPUB),
    signPsbt: vi.fn().mockResolvedValue(options.signatures ?? []),
  };
}

describe('Ledger signPsbt account binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockReturnValue(makeValidated());
  });

  it('uses the exact validated account path and xpub without rewriting the PSBT', async () => {
    const signature = {
      pubkey: Uint8Array.from([2, ...new Array(32).fill(1)]),
      signature: Uint8Array.from([0x30, 0x44]),
    };
    const client = makeClient({ signatures: [[0, signature]] });
    const result = await signPsbt(client as never, {
      walletId: 'wallet-1',
      psbt: 'unsigned-psbt',
    });

    expect(mockValidate).toHaveBeenCalledWith(expect.objectContaining({ psbt: 'unsigned-psbt' }), 'aabbccdd');
    expect(client.getExtendedPubkey).toHaveBeenCalledWith(ACCOUNT_PATH);
    expect(MockDefaultWalletPolicy).toHaveBeenCalledWith(
      'wpkh(@0/**)',
      `[aabbccdd/84'/0'/7']${XPUB}`,
    );
    expect(client.signPsbt).toHaveBeenCalledWith('unsigned-psbt', expect.any(Object), null);
    const validated = mockValidate.mock.results[0].value;
    expect(validated.psbt.updateInput).toHaveBeenCalledWith(0, { partialSig: [signature] });
    expect(validated.psbt.finalizeAllInputs).toHaveBeenCalledOnce();
    expect(result).toEqual({ psbt: 'signed-psbt', signatures: 1 });
  });

  it.each([
    {
      scriptType: 'legacy' as const,
      accountPath: "m/44'/0'/2'",
      accountXpub: 'xpub-legacy-account',
      descriptorTemplate: 'pkh(@0/**)',
    },
    {
      scriptType: 'nested_segwit' as const,
      accountPath: "m/49'/0'/3'",
      accountXpub: 'xpub-nested-account',
      descriptorTemplate: 'sh(wpkh(@0/**))',
    },
    {
      scriptType: 'taproot' as const,
      accountPath: "m/86'/0'/4'",
      accountXpub: 'xpub-taproot-account',
      descriptorTemplate: 'tr(@0/**)',
    },
  ])(
    'uses the $descriptorTemplate policy only when validation admits $scriptType',
    async ({ scriptType, accountPath, accountXpub, descriptorTemplate }) => {
      mockValidate.mockReturnValue(makeValidated({
        scriptType,
        accountPath,
        accountXpub,
      }));
      const client = makeClient({ xpub: accountXpub });

      await expect(signPsbt(client as never, {
        walletId: 'wallet-1',
        psbt: 'unsigned-psbt',
      })).resolves.toEqual({ psbt: 'signed-psbt', signatures: 0 });

      expect(client.getExtendedPubkey).toHaveBeenCalledWith(accountPath);
      expect(MockDefaultWalletPolicy).toHaveBeenCalledWith(
        descriptorTemplate,
        `[aabbccdd/${accountPath.replace(/^m\//, '')}]${accountXpub}`,
      );
      expect(client.signPsbt).toHaveBeenCalledWith(
        'unsigned-psbt',
        expect.any(Object),
        null,
      );
      expect(mockValidate.mock.results[0].value.psbt.finalizeAllInputs)
        .toHaveBeenCalledOnce();
    },
  );

  it('rejects a connected Ledger account xpub mismatch before signing', async () => {
    const client = makeClient({ xpub: 'xpub-wrong-account' });
    await expect(signPsbt(client as never, { walletId: 'wallet-1', psbt: 'psbt' }))
      .rejects.toThrow(/account xpub/i);
    expect(client.signPsbt).not.toHaveBeenCalled();
  });

  it('keeps Ledger multisig blocked until its separate physical policy proof', async () => {
    mockValidate.mockReturnValue(makeValidated({ walletType: 'multi_sig' }));
    const client = makeClient();
    await expect(signPsbt(client as never, { walletId: 'wallet-1', psbt: 'psbt' }))
      .rejects.toThrow(/multisig USB signing is blocked/i);
    expect(client.getExtendedPubkey).not.toHaveBeenCalled();
  });

  it('rejects a Ledger signature for an input outside the server binding', async () => {
    const client = makeClient({
      signatures: [[1, {
        pubkey: Uint8Array.from([2, ...new Array(32).fill(1)]),
        signature: Uint8Array.from([0x30, 0x44]),
      }]],
    });
    await expect(signPsbt(client as never, { walletId: 'wallet-1', psbt: 'psbt' }))
      .rejects.toThrow(/unbound input 1/i);
    expect(mockValidate.mock.results[0].value.psbt.updateInput).not.toHaveBeenCalled();
  });
});

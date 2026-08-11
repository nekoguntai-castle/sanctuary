import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockDefaultWalletPolicy, mockValidate } = vi.hoisted(() => ({
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

const FINGERPRINT = 'aabbccdd';
const ACCOUNT_PATH = "m/84'/0'/7'";
const XPUB = 'xpub-wallet-selected';
const COMPRESSED_PUBKEY = Uint8Array.from([2, ...new Array(32).fill(1)]);
const X_ONLY_PUBKEY = Uint8Array.from(new Array(32).fill(2));
const TAPROOT_OUTPUT_KEY = Uint8Array.from(new Array(32).fill(3));

type ValidatedOptions = {
  walletType?: 'single_sig' | 'multi_sig';
  scriptType?: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
  accountPath?: string;
  accountXpub?: string;
  network?: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';
  inputIndex?: number;
};

function makeValidated(options: ValidatedOptions = {}) {
  const accountPath = options.accountPath ?? ACCOUNT_PATH;
  const accountXpub = options.accountXpub ?? XPUB;
  const scriptType = options.scriptType ?? 'native_segwit';
  const inputIndex = options.inputIndex ?? 0;
  const pubkey = scriptType === 'taproot' ? X_ONLY_PUBKEY : COMPRESSED_PUBKEY;
  const psbt = {
    data: {
      inputs: [{
        witnessUtxo: {
          script: Uint8Array.from([0x51, 0x20, ...TAPROOT_OUTPUT_KEY]),
          value: 100_000n,
        },
      }],
    },
    updateInput: vi.fn(),
    finalizeAllInputs: vi.fn(),
    toBase64: vi.fn(() => 'signed-psbt'),
  };
  return {
    psbt,
    network: options.network ?? 'mainnet',
    context: {
      walletType: options.walletType ?? 'single_sig',
      scriptType,
      inputs: [{
        inputIndex,
        signerOrigins: [{
          masterFingerprint: FINGERPRINT,
          path: `${accountPath}/0/0`,
          pubkey: Buffer.from(pubkey).toString('hex'),
        }],
      }],
    },
    connectedSigner: {
      masterFingerprint: FINGERPRINT,
      accountPath,
      accountXpub,
    },
    changeOutputIndexes: [1],
    accountPath,
  };
}

type Signature = { pubkey: Uint8Array; signature: Uint8Array; tapleafHash?: Uint8Array };

function makeClient(options: {
  appName?: string;
  xpub?: string;
  signatures?: Array<[number, Signature]>;
} = {}) {
  return {
    getAppAndVersion: vi.fn().mockResolvedValue({
      name: options.appName ?? 'Bitcoin', version: '2.4.2', flags: 0,
    }),
    getMasterFingerprint: vi.fn().mockResolvedValue(FINGERPRINT.toUpperCase()),
    getExtendedPubkey: vi.fn().mockResolvedValue(options.xpub ?? XPUB),
    signPsbt: vi.fn().mockResolvedValue(options.signatures ?? []),
  };
}

describe('Ledger signPsbt account and signature binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockReturnValue(makeValidated());
  });

  it('uses the validated default policy and records the exact Ledger artifact', async () => {
    const signature = { pubkey: COMPRESSED_PUBKEY, signature: Uint8Array.from([0x30, 0x44]) };
    const client = makeClient({ signatures: [[0, signature]] });
    const result = await signPsbt(client as never, { walletId: 'wallet-1', psbt: 'unsigned-psbt' });

    expect(mockValidate).toHaveBeenCalledWith(expect.objectContaining({ psbt: 'unsigned-psbt' }), FINGERPRINT);
    expect(client.getAppAndVersion).toHaveBeenCalledOnce();
    expect(client.getExtendedPubkey).toHaveBeenCalledWith(ACCOUNT_PATH, false);
    expect(MockDefaultWalletPolicy).toHaveBeenCalledWith(
      'wpkh(@0/**)',
      `[${FINGERPRINT}/84'/0'/7']${XPUB}`,
    );
    expect(client.signPsbt).toHaveBeenCalledWith('unsigned-psbt', expect.any(Object), null);
    const validated = mockValidate.mock.results[0].value;
    expect(validated.psbt.updateInput).toHaveBeenCalledWith(0, { partialSig: [signature] });
    expect(validated.psbt.finalizeAllInputs).toHaveBeenCalledOnce();
    expect(result).toEqual({
      psbt: 'signed-psbt',
      signatures: 1,
      ledgerArtifact: {
        type: 'ledger-signed-psbt',
        sourcePsbt: 'unsigned-psbt',
        signatures: [{
          inputIndex: 0,
          pubkey: Buffer.from(COMPRESSED_PUBKEY).toString('hex'),
          signature: '3044',
        }],
        reconstructedPsbt: 'signed-psbt',
      },
    });
  });

  it.each([
    ['legacy', "m/44'/0'/2'", 'xpub-legacy', 'pkh(@0/**)'],
    ['nested_segwit', "m/49'/0'/3'", 'xpub-nested', 'sh(wpkh(@0/**))'],
    ['native_segwit', "m/84'/0'/4'", 'xpub-native', 'wpkh(@0/**)'],
  ] as const)('constructs the canonical %s policy', async (scriptType, accountPath, accountXpub, template) => {
    mockValidate.mockReturnValue(makeValidated({ scriptType, accountPath, accountXpub }));
    const client = makeClient({ xpub: accountXpub });
    await signPsbt(client as never, { walletId: 'wallet-1', psbt: 'unsigned-psbt' });
    expect(MockDefaultWalletPolicy).toHaveBeenCalledWith(
      template,
      `[${FINGERPRINT}/${accountPath.replace(/^m\//, '')}]${accountXpub}`,
    );
  });

  it.each(['testnet3', 'testnet4', 'signet', 'regtest'] as const)(
    'requires Bitcoin Test for the %s derivation family',
    async (network) => {
      const accountPath = "m/84'/1'/7'";
      mockValidate.mockReturnValue(makeValidated({ network, accountPath, accountXpub: 'tpub-selected' }));
      const wrongClient = makeClient({ appName: 'Bitcoin', xpub: 'tpub-selected' });
      await expect(signPsbt(wrongClient as never, { psbt: 'unsigned-psbt' }))
        .rejects.toThrow(/Bitcoin Test app is required/);
      expect(wrongClient.signPsbt).not.toHaveBeenCalled();
    },
  );

  it('places a BIP371 key-path Schnorr signature in tapKeySig', async () => {
    const accountPath = "m/86'/0'/7'";
    mockValidate.mockReturnValue(makeValidated({
      scriptType: 'taproot', accountPath, accountXpub: 'xpub-taproot',
    }));
    const signature = { pubkey: TAPROOT_OUTPUT_KEY, signature: Uint8Array.from(new Array(64).fill(3)) };
    const client = makeClient({ xpub: 'xpub-taproot', signatures: [[0, signature]] });
    const result = await signPsbt(client as never, { psbt: 'unsigned-taproot-psbt' });
    const validated = mockValidate.mock.results[0].value;
    expect(validated.psbt.updateInput).toHaveBeenCalledWith(0, { tapKeySig: signature.signature });
    expect(validated.psbt.updateInput).not.toHaveBeenCalledWith(0, expect.objectContaining({ partialSig: expect.anything() }));
    expect(result.ledgerArtifact).toBeDefined();
    expect(result.ledgerArtifact!.signatures[0]).toEqual({
      inputIndex: 0,
      pubkey: Buffer.from(TAPROOT_OUTPUT_KEY).toString('hex'),
      signature: Buffer.from(signature.signature).toString('hex'),
    });
  });

  it('rejects Taproot script-path signatures before PSBT mutation', async () => {
    mockValidate.mockReturnValue(makeValidated({ scriptType: 'taproot', accountPath: "m/86'/0'/7'" }));
    const client = makeClient({ signatures: [[0, {
      pubkey: TAPROOT_OUTPUT_KEY,
      signature: Uint8Array.from(new Array(64).fill(3)),
      tapleafHash: Uint8Array.from(new Array(32).fill(4)),
    }]] });
    await expect(signPsbt(client as never, { psbt: 'psbt' })).rejects.toThrow(/script-path/i);
    expect(mockValidate.mock.results[0].value.psbt.updateInput).not.toHaveBeenCalled();
  });

  it('rejects a Taproot signature when the verified P2TR output key is unavailable', async () => {
    const validated = makeValidated({ scriptType: 'taproot' });
    validated.psbt.data.inputs[0].witnessUtxo.script = Uint8Array.from([0x51, 0x20]);
    mockValidate.mockReturnValue(validated);
    const client = makeClient({ signatures: [[0, {
      pubkey: TAPROOT_OUTPUT_KEY,
      signature: Uint8Array.from(new Array(64).fill(3)),
    }]] });
    await expect(signPsbt(client as never, { psbt: 'psbt' }))
      .rejects.toThrow(/missing its verified output key/i);
    expect(validated.psbt.updateInput).not.toHaveBeenCalled();
  });

  it('rejects duplicate Ledger input signatures before PSBT mutation', async () => {
    const signature = { pubkey: COMPRESSED_PUBKEY, signature: Uint8Array.from([0x30]) };
    const client = makeClient({ signatures: [[0, signature], [0, signature]] });
    await expect(signPsbt(client as never, { psbt: 'psbt' }))
      .rejects.toThrow(/duplicate signatures/i);
    expect(mockValidate.mock.results[0].value.psbt.updateInput).not.toHaveBeenCalled();
  });

  it('rejects account xpub, unbound input, unexpected key, and malformed key data', async () => {
    await expect(signPsbt(makeClient({ xpub: 'xpub-wrong' }) as never, { psbt: 'psbt' }))
      .rejects.toThrow(/account xpub/i);

    const unbound = makeClient({ signatures: [[1, {
      pubkey: COMPRESSED_PUBKEY, signature: Uint8Array.from([0x30]),
    }]] });
    await expect(signPsbt(unbound as never, { psbt: 'psbt' })).rejects.toThrow(/unbound input 1/i);

    const unexpected = makeClient({ signatures: [[0, {
      pubkey: Uint8Array.from([3, ...new Array(32).fill(9)]), signature: Uint8Array.from([0x30]),
    }]] });
    await expect(signPsbt(unexpected as never, { psbt: 'psbt' })).rejects.toThrow(/unexpected key/i);

    const malformed = makeClient({ signatures: [[0, {
      pubkey: Uint8Array.from(new Array(32).fill(1)), signature: Uint8Array.from([0x30]),
    }]] });
    await expect(signPsbt(malformed as never, { psbt: 'psbt' })).rejects.toThrow(/unexpected key|malformed/i);

    mockValidate.mockReturnValue(makeValidated({ scriptType: 'taproot' }));
    const unexpectedTaproot = makeClient({ signatures: [[0, {
      pubkey: X_ONLY_PUBKEY,
      signature: Uint8Array.from(new Array(64).fill(3)),
    }]] });
    await expect(signPsbt(unexpectedTaproot as never, { psbt: 'psbt' }))
      .rejects.toThrow(/unexpected key/i);
  });

  it('rejects every malformed signature shape after signer binding', async () => {
    const missingSigner = makeValidated();
    missingSigner.context.inputs[0].signerOrigins = [];
    mockValidate.mockReturnValueOnce(missingSigner);
    await expect(signPsbt(makeClient({ signatures: [[0, {
      pubkey: COMPRESSED_PUBKEY,
      signature: Uint8Array.from([0x30]),
    }]] }) as never, { psbt: 'psbt' })).rejects.toThrow(/unexpected key/i);

    const malformedTaproot = makeValidated({ scriptType: 'taproot' });
    mockValidate.mockReturnValueOnce(malformedTaproot);
    await expect(signPsbt(makeClient({ signatures: [[0, {
      pubkey: TAPROOT_OUTPUT_KEY,
      signature: Uint8Array.from(new Array(63).fill(3)),
    }]] }) as never, { psbt: 'psbt' })).rejects.toThrow(/malformed Taproot/i);

    const tapleafOnSegwit = makeValidated();
    mockValidate.mockReturnValueOnce(tapleafOnSegwit);
    await expect(signPsbt(makeClient({ signatures: [[0, {
      pubkey: COMPRESSED_PUBKEY,
      signature: Uint8Array.from([0x30]),
      tapleafHash: Uint8Array.from(new Array(32).fill(4)),
    }]] }) as never, { psbt: 'psbt' })).rejects.toThrow(/unexpected Taproot script-path/i);

    const shortPubkey = Uint8Array.from(new Array(32).fill(7));
    const malformedSegwit = makeValidated();
    malformedSegwit.context.inputs[0].signerOrigins[0].pubkey = Buffer.from(shortPubkey).toString('hex');
    mockValidate.mockReturnValueOnce(malformedSegwit);
    await expect(signPsbt(makeClient({ signatures: [[0, {
      pubkey: shortPubkey,
      signature: Uint8Array.from([0x30]),
    }]] }) as never, { psbt: 'psbt' })).rejects.toThrow(/malformed public key/i);
  });

  it('keeps Ledger multisig blocked before session, xpub, or policy work', async () => {
    mockValidate.mockReturnValue(makeValidated({ walletType: 'multi_sig' }));
    const client = makeClient();
    await expect(signPsbt(client as never, { psbt: 'psbt' }))
      .rejects.toThrow(/multisig USB signing is blocked/i);
    expect(client.getAppAndVersion).not.toHaveBeenCalled();
    expect(client.getExtendedPubkey).not.toHaveBeenCalled();
    expect(client.signPsbt).not.toHaveBeenCalled();
  });
});

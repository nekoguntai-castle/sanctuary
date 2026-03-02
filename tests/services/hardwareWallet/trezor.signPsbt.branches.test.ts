import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { signPsbtWithTrezor } from '../../../services/hardwareWallet/adapters/trezor/signPsbt';

const {
  mockSignTransaction,
  mockGetTrezorScriptType,
  mockPathToAddressN,
  mockValidateSatoshiAmount,
  mockBuildTrezorMultisig,
  mockIsMultisigInput,
  mockFetchRefTxs,
  mockLoggerError,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockSignTransaction: vi.fn(),
  mockGetTrezorScriptType: vi.fn(),
  mockPathToAddressN: vi.fn(),
  mockValidateSatoshiAmount: vi.fn(),
  mockBuildTrezorMultisig: vi.fn(),
  mockIsMultisigInput: vi.fn(),
  mockFetchRefTxs: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@trezor/connect-web', () => ({
  default: {
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  },
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/pathUtils', () => ({
  getTrezorScriptType: (...args: unknown[]) => mockGetTrezorScriptType(...args),
  pathToAddressN: (...args: unknown[]) => mockPathToAddressN(...args),
  validateSatoshiAmount: (...args: unknown[]) => mockValidateSatoshiAmount(...args),
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/multisig', () => ({
  buildTrezorMultisig: (...args: unknown[]) => mockBuildTrezorMultisig(...args),
  isMultisigInput: (...args: unknown[]) => mockIsMultisigInput(...args),
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/refTxs', () => ({
  fetchRefTxs: (...args: unknown[]) => mockFetchRefTxs(...args),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  }),
}));

function createPsbt({
  includeInputDerivation = true,
  includeWitnessUtxo = true,
  includeChangeDerivation = true,
}: {
  includeInputDerivation?: boolean;
  includeWitnessUtxo?: boolean;
  includeChangeDerivation?: boolean;
} = {}) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  const inputPubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
  const inputScript = Buffer.from(`0014${'11'.repeat(20)}`, 'hex');

  const input: any = {
    hash: 'aa'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
  };

  if (includeWitnessUtxo) {
    input.witnessUtxo = {
      script: inputScript,
      value: 50_000,
    };
  }

  if (includeInputDerivation) {
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/49'/0'/0'/0/0",
        pubkey: inputPubkey,
      },
    ];
  }

  psbt.addInput(input);

  psbt.addOutput({
    script: Buffer.from(`0014${'22'.repeat(20)}`, 'hex'),
    value: 40_000,
  });

  const changeOutput: any = {
    script: Buffer.from(`0014${'33'.repeat(20)}`, 'hex'),
    value: 9_000,
  };
  if (includeChangeDerivation) {
    changeOutput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/49'/0'/0'/1/0",
        pubkey: inputPubkey,
      },
    ];
  }
  psbt.addOutput(changeOutput);

  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  const signedTxHex = bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer()).toHex();
  return { psbt, signedTxHex };
}

function txFromPsbt(psbt: bitcoin.Psbt) {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  return bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer());
}

describe('signPsbtWithTrezor branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathToAddressN.mockReturnValue([1, 2, 3]);
    mockValidateSatoshiAmount.mockImplementation((amount: number | bigint) => String(amount));
    mockGetTrezorScriptType.mockReturnValue('SPENDWITNESS');
    mockBuildTrezorMultisig.mockReturnValue(undefined);
    mockIsMultisigInput.mockReturnValue(false);
    mockFetchRefTxs.mockResolvedValue([]);
  });

  it('uses mainnet request path detection and maps change output to PAYTOP2SHWITNESS', async () => {
    const { psbt, signedTxHex } = createPsbt();
    mockGetTrezorScriptType.mockReturnValue('SPENDP2SHWITNESS');
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/49'/0'/0'",
        inputPaths: [],
      },
      { fingerprint: undefined } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Bitcoin');
    expect(call.outputs[1].script_type).toBe('PAYTOP2SHWITNESS');
  });

  it('falls back to request.inputPaths when input bip32 derivation is missing', async () => {
    const { psbt, signedTxHex } = createPsbt({ includeInputDerivation: false });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/7"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/7");
  });

  it('maps change output to PAYTOTAPROOT and includes multisig output payload when built', async () => {
    const { psbt, signedTxHex } = createPsbt();
    mockGetTrezorScriptType.mockReturnValue('SPENDTAPROOT');
    mockBuildTrezorMultisig.mockReturnValue({
      m: 2,
      pubkeys: [],
      signatures: [],
    });

    const output = psbt.data.outputs[1] as any;
    output.witnessScript = Buffer.from('512102' + '11'.repeat(32) + '51ae', 'hex');
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];

    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/86'/0'/0'",
        inputPaths: ["m/86'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
    expect(call.outputs[1].multisig).toBeDefined();
  });

  it('logs mismatched witness amount against fetched ref transaction output', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [{ amount: '999999' }],
      },
    ]);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('continues when multisig signature extraction throws in nested try/catch', async () => {
    const { psbt, signedTxHex } = createPsbt();
    (psbt.data.inputs[0] as any).witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    mockIsMultisigInput.mockReturnValue(true);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const originalFromHex = bitcoin.Transaction.fromHex.bind(bitcoin.Transaction);
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
    fromHexSpy.mockImplementationOnce((hex: string) => originalFromHex(hex));
    fromHexSpy.mockImplementationOnce(() => {
      throw new Error('extract failure');
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(response.rawTx).toBe(signedTxHex);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to extract signatures from Trezor rawTx',
      expect.any(Object)
    );

    fromHexSpy.mockRestore();
  });

  it('detects testnet from request input path and maps SPENDADDRESS change outputs', async () => {
    const { psbt, signedTxHex } = createPsbt({ includeInputDerivation: false });
    mockGetTrezorScriptType.mockReturnValue('SPENDADDRESS');
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ['m/44h/1h/0h/0/0'],
      },
      { fingerprint: undefined } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Testnet');
    expect(call.outputs[0].address.startsWith('tb1')).toBe(true);
    expect(call.outputs[1].script_type).toBe('PAYTOADDRESS');
  });

  it('treats /0h/ request paths as explicit mainnet hints', async () => {
    const { psbt, signedTxHex } = createPsbt({ includeInputDerivation: false });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: 'm/84h/0h/0h',
      },
      { fingerprint: undefined } as any
    );

    expect(mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Bitcoin');
  });

  it('uses bip32 derivation paths when request paths are empty and supports testnet/mainnet detection', async () => {
    const mainnet = createPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: mainnet.signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: mainnet.psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Bitcoin');

    const testnet = createPsbt();
    (testnet.psbt.data.inputs[0] as any).bip32Derivation[0].path = "m/84'/1'/0'/0/0";
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: testnet.signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: testnet.psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Testnet');
  });

  it('throws when the connected device fingerprint is not a multisig cosigner', async () => {
    const { psbt } = createPsbt();
    const input = psbt.data.inputs[0] as any;
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('bbbbbbbb', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'55'.repeat(32)}`, 'hex'),
      },
    ];

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/48'/0'/0'/2'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('is not a cosigner');

    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it('selects matching fingerprint derivations for inputs, change outputs, and first-input account path', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const input = psbt.data.inputs[0] as any;
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/84'/0'/0'/0/5",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/84'/0'/0'/0/9",
        pubkey: Buffer.from(`03${'33'.repeat(32)}`, 'hex'),
      },
    ];

    const output = psbt.data.outputs[1] as any;
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/84'/0'/0'/1/5",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/84'/0'/0'/1/9",
        pubkey: Buffer.from(`03${'33'.repeat(32)}`, 'hex'),
      },
    ];

    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/9");
    expect(mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/1/9");
  });

  it('supports inputs without derivation and without request.inputPaths for that index', async () => {
    const { psbt, signedTxHex } = createPsbt({ includeInputDerivation: false });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].address_n).toEqual([]);
  });

  it('handles mixed multisig matching: builds for matched inputs and warns on non-matching secondary derivations', async () => {
    const { psbt } = createPsbt();
    const firstInput = psbt.data.inputs[0] as any;
    firstInput.witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    firstInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/1",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'11'.repeat(32)}`, 'hex'),
      },
    ];

    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 0,
      sequence: 0xfffffffc,
      witnessUtxo: {
        script: Buffer.from(`0014${'44'.repeat(20)}`, 'hex'),
        value: 20_000,
      },
      bip32Derivation: [
        {
          masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
          path: "m/48'/0'/0'/2'/0/2",
          pubkey: Buffer.from(`02${'55'.repeat(32)}`, 'hex'),
        },
        {
          masterFingerprint: Buffer.from('bbbbbbbb', 'hex'),
          path: "m/48'/0'/0'/2'/0/2",
          pubkey: Buffer.from(`03${'66'.repeat(32)}`, 'hex'),
        },
      ],
      witnessScript: Buffer.from('5221' + '22'.repeat(33) + '51ae', 'hex'),
    } as any);
    psbt.addOutput({
      script: Buffer.from(`0014${'66'.repeat(20)}`, 'hex'),
      value: 19_000,
    });

    const changeOutput = psbt.data.outputs[1] as any;
    changeOutput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/1/2",
        pubkey: Buffer.from(`02${'55'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('bbbbbbbb', 'hex'),
        path: "m/48'/0'/0'/2'/1/2",
        pubkey: Buffer.from(`03${'66'.repeat(32)}`, 'hex'),
      },
    ];

    mockIsMultisigInput.mockReturnValue(true);
    mockBuildTrezorMultisig.mockReturnValue({
      m: 2,
      pubkeys: [],
      signatures: [],
    });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: txFromPsbt(psbt).toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].multisig).toBeDefined();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'No matching bip32Derivation found for device fingerprint',
      expect.any(Object)
    );
  });

  it('logs transaction mismatches for version, locktime, outputs, and inputs', async () => {
    const { psbt } = createPsbt();
    const tx = txFromPsbt(psbt) as any;
    tx.version += 1;
    tx.locktime += 1;
    tx.outs[0].value = Number(tx.outs[0].value) + 1;
    tx.ins[0].index += 1;

    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Transaction version mismatch - Trezor signed different version',
      expect.any(Object)
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Transaction locktime mismatch',
      expect.any(Object)
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Output mismatch between PSBT and Trezor signed transaction',
      expect.any(Object)
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Input mismatch between PSBT and Trezor signed transaction',
      expect.any(Object)
    );
  });

  it('handles multisig change output when buildTrezorMultisig returns undefined', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const output = psbt.data.outputs[1] as any;
    output.witnessScript = Buffer.from('512102' + '11'.repeat(32) + '51ae', 'hex');
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];
    mockBuildTrezorMultisig.mockReturnValue(undefined);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/86'/0'/0'",
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].multisig).toBeUndefined();
  });

  it('skips ref-output mismatch logging when referenced vout is missing', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [],
      },
    ]);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerError).not.toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('does not log ref-output mismatch when witnessUtxo amount matches', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [{ amount: 50_000 }],
      },
    ]);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerError).not.toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('extracts multisig signatures into partialSig and avoids duplicates', async () => {
    const { psbt } = createPsbt();
    const pubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      pubkey,
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey,
      },
    ];

    mockIsMultisigInput.mockReturnValue(true);

    const tx = txFromPsbt(psbt);
    const signature = Buffer.from('300102', 'hex');
    tx.ins[0].witness = [Buffer.alloc(0), signature, witnessScript];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    const partialSig = (parsed.data.inputs[0] as any).partialSig;
    expect(partialSig).toHaveLength(1);
    expect(partialSig[0].pubkey.equals(pubkey)).toBe(true);
    expect(partialSig[0].signature.equals(signature)).toBe(true);

    const existing = psbt.data.inputs[0] as any;
    existing.partialSig = [{ pubkey, signature: Buffer.from('300103', 'hex') }];
    const tx2 = txFromPsbt(psbt);
    tx2.ins[0].witness = [Buffer.alloc(0), Buffer.from('300104', 'hex'), Buffer.from('51ae', 'hex')];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx2.toHex() },
    });

    const second = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );
    const secondParsed = bitcoin.Psbt.fromBase64(second.psbt);
    expect(((secondParsed.data.inputs[0] as any).partialSig || []).length).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'WitnessScript mismatch - Trezor signed with different script',
      expect.any(Object)
    );
  });

  it('warns when multisig signatures cannot be matched to this device fingerprint', async () => {
    const { psbt } = createPsbt();
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];

    mockIsMultisigInput.mockReturnValue(true);

    const tx = txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('300102', 'hex'), witnessScript];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.any(Object)
    );
  });

  it('handles OP_N sentinel while parsing witnessScript pubkeys', async () => {
    const { psbt } = createPsbt();
    const pubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.from([0x52, 0x51, 0x00, 0xae]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey,
      },
    ];

    mockIsMultisigInput.mockReturnValue(true);
    const tx = txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3003', 'hex'), witnessScript];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    expect(((parsed.data.inputs[0] as any).partialSig || []).length).toBe(1);
  });

  it('skips extraction for inputs without witness data or witnessScript', async () => {
    const { psbt } = createPsbt();
    mockIsMultisigInput.mockReturnValue(true);

    const tx = txFromPsbt(psbt);
    tx.ins[0].witness = [];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(response.rawTx).toBe(tx.toHex());
  });

  it('appends partial signatures when partialSig exists for other pubkeys', async () => {
    const { psbt } = createPsbt();
    const trezorPubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const otherPubkey = Buffer.from(`03${'22'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.from('51200051ae', 'hex');
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: trezorPubkey,
      },
    ];
    psbtInput.partialSig = [{ pubkey: otherPubkey, signature: Buffer.from('3001', 'hex') }];

    mockIsMultisigInput.mockReturnValue(true);
    const tx = txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3002', 'hex'), witnessScript];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    expect(((parsed.data.inputs[0] as any).partialSig || []).length).toBe(2);
  });

  it('warns during extraction when no device fingerprint is provided', async () => {
    const { psbt } = createPsbt();
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
    ];

    mockIsMultisigInput.mockReturnValue(true);
    const tx = txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3002', 'hex'), witnessScript];
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
      },
      { fingerprint: undefined } as any
    );

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.any(Object)
    );
  });

  it('handles unsuccessful Trezor responses and signed payloads without serializedTx', async () => {
    const { psbt } = createPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Denied by device' },
    });
    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Denied by device');

    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: {},
    } as any);
    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Signing failed');

    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: {},
    } as any);
    const noRawTx = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(noRawTx.rawTx).toBeUndefined();
  });

  it('maps known device error messages to user-facing errors', async () => {
    const { psbt } = createPsbt({ includeWitnessUtxo: false });
    const scenarios = [
      {
        message: 'Cancelled by user',
        expected: 'Transaction rejected on Trezor. Please approve the transaction on your device.',
      },
      {
        message: 'PIN invalid',
        expected: 'Incorrect PIN. Please try again.',
      },
      {
        message: 'Passphrase required',
        expected: 'Passphrase entry cancelled.',
      },
      {
        message: 'no device',
        expected: 'Trezor disconnected. Please reconnect and try again.',
      },
      {
        message: 'Forbidden key path',
        expected: 'Trezor blocked this derivation path.',
      },
      {
        message: 'Wrong derivation path',
        expected: 'The derivation path does not match your Trezor account.',
      },
    ];

    for (const scenario of scenarios) {
      mockSignTransaction.mockRejectedValueOnce(new Error(scenario.message));
      await expect(
        signPsbtWithTrezor(
          {
            psbt: psbt.toBase64(),
            inputPaths: ["m/84'/0'/0'/0/0"],
          },
          { fingerprint: 'deadbeef' } as any
        )
      ).rejects.toThrow(scenario.expected);
    }
  });

  it('formats extraction warning with String(...) when nested extraction throws non-Error values', async () => {
    const { psbt, signedTxHex } = createPsbt();
    (psbt.data.inputs[0] as any).witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    mockIsMultisigInput.mockReturnValue(true);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const originalFromHex = bitcoin.Transaction.fromHex.bind(bitcoin.Transaction);
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
    fromHexSpy.mockImplementationOnce((hex: string) => originalFromHex(hex));
    fromHexSpy.mockImplementationOnce(() => {
      throw 'extract-failure-string';
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to extract signatures from Trezor rawTx',
      { error: 'extract-failure-string' }
    );

    fromHexSpy.mockRestore();
  });

  it('wraps non-Error throwables as unknown signing failures', async () => {
    const { psbt } = createPsbt({ includeWitnessUtxo: false });
    mockSignTransaction.mockRejectedValueOnce('boom');

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Unknown error');
  });
});

/**
 * Trezor adapter and helper coverage tests
 */

import * as bitcoin from 'bitcoinjs-lib';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
  createMultisigPsbt,
  createRefTxHex,
  createSignedMultisigTxHex,
  createSingleSigPsbt,
  hexToBytes,
  originalWindow,
  setSecureContext,
  slip132Key,
  unsignedTxHexFromPsbt,
} from './hardwareWallet/trezorAdapterTestHarness';

const mockInit = vi.fn();
const mockGetFeatures = vi.fn();
const mockGetPublicKey = vi.fn();
const mockSignTransaction = vi.fn();
const mockApiGet = vi.fn();

vi.mock('@trezor/connect-web', () => ({
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    getFeatures: (...args: unknown[]) => mockGetFeatures(...args),
    getPublicKey: (...args: unknown[]) => mockGetPublicKey(...args),
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  },
}));

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
TrezorAdapter,
buildTrezorMultisig,
convertToStandardXpub,
getAccountPathPrefix,
getTrezorScriptType,
isBip48MultisigPath,
validateSatoshiAmount,
} from '../../services/hardwareWallet/adapters/trezor';

describe('Trezor helper functions', () => {
  it('validates satoshi amounts for number and bigint', () => {
    expect(validateSatoshiAmount(123, 'test')).toBe('123');
    expect(validateSatoshiAmount(123n, 'test')).toBe('123');
    expect(() => validateSatoshiAmount(undefined, 'ctx')).toThrow('ctx: amount is missing');
    expect(() => validateSatoshiAmount(-1, 'ctx')).toThrow('ctx: invalid amount');
  });

  it('converts SLIP-132 pubkeys to standard xpub/tpub', () => {
    const zpubLike = slip132Key('04b24746'); // mainnet native segwit
    const vpubLike = slip132Key('045f1cf6'); // testnet native segwit
    const already = slip132Key('0488b21e'); // xpub version
    const unknownVersion = slip132Key('01020304');
    const invalid = 'not-a-valid-base58';

    const convertedMain = convertToStandardXpub(zpubLike);
    const convertedTest = convertToStandardXpub(vpubLike);
    const unchanged = convertToStandardXpub(already);
    const unknownUnchanged = convertToStandardXpub(unknownVersion);
    const passthrough = convertToStandardXpub(invalid);

    expect(convertedMain.startsWith('xpub')).toBe(true);
    expect(convertedTest.startsWith('tpub')).toBe(true);
    expect(unchanged).toBe(already);
    expect(unknownUnchanged).toBe(unknownVersion);
    expect(passthrough).toBe(invalid);
  });

  it('maps derivation paths to trezor script types', () => {
    expect(getTrezorScriptType("m/44'/0'/0'")).toBe('SPENDADDRESS');
    expect(getTrezorScriptType("m/49'/0'/0'")).toBe('SPENDP2SHWITNESS');
    expect(getTrezorScriptType("m/84'/0'/0'")).toBe('SPENDWITNESS');
    expect(getTrezorScriptType("m/86'/0'/0'")).toBe('SPENDTAPROOT');
    expect(getTrezorScriptType("m/48'/0'/0'/2'")).toBe('SPENDWITNESS');
    expect(getTrezorScriptType("m/48'/0'/0'/1'")).toBe('SPENDP2SHWITNESS');
    expect(getTrezorScriptType('m/99/0/0')).toBe('SPENDWITNESS');
  });

  it('identifies BIP48 paths and account prefixes', () => {
    expect(isBip48MultisigPath("m/48'/0'/0'/2'")).toBe(true);
    expect(isBip48MultisigPath('m/84/0/0')).toBe(false);
    expect(getAccountPathPrefix("m/48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
  });

  it('builds multisig structure and handles missing/invalid scripts', () => {
    const pub1 = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const pub2 = Buffer.from(`03${'22'.repeat(32)}`, 'hex');
    const script = Buffer.concat([
      Buffer.from([0x52, 0x21]),
      pub1,
      Buffer.from([0x21]),
      pub2,
      Buffer.from([0x52, 0xae]),
    ]); // OP_2 <pk1> <pk2> OP_2 OP_CHECKMULTISIG

    const derivations = [
      { pubkey: pub2, path: "m/48'/0'/0'/2'/1/7", masterFingerprint: Buffer.from('bbbbbbbb', 'hex') },
      { pubkey: pub1, path: "m/48'/0'/0'/2'/0/5", masterFingerprint: Buffer.from('aaaaaaaa', 'hex') },
    ];
    const xpubMap = {
      aaaaaaaa: slip132Key('04b24746'),
      bbbbbbbb: slip132Key('045f1cf6'),
    };

    const multisig = buildTrezorMultisig(script, derivations as any, xpubMap);
    expect(multisig).not.toBeNull();
    expect(multisig?.m).toBe(2);
    expect(multisig?.signatures).toEqual(['', '']);
    expect(multisig?.pubkeys).toHaveLength(2);
    expect(multisig?.pubkeys[0].address_n).toEqual([0, 5]);
    expect(multisig?.pubkeys[1].address_n).toEqual([1, 7]);
    expect(multisig?.pubkeys[0].node.startsWith('xpub')).toBe(true);

    // Fallback path when xpubMap does not include fingerprints.
    const noXpub = buildTrezorMultisig(script, derivations as any, {});
    expect(noXpub?.pubkeys[0].node).toMatch(/^[0-9a-f]+$/i);

    expect(buildTrezorMultisig(undefined, derivations as any, xpubMap)).toBeUndefined();
    expect(buildTrezorMultisig(Buffer.from([0x01, 0x02, 0x03]), derivations as any, xpubMap)).toBeUndefined();

    // Force catch path with invalid derivation shape.
    expect(
      buildTrezorMultisig(
        script,
        [
          { path: "m/48'/0'/0'/2'/0/1", masterFingerprint: Buffer.from('aaaaaaaa', 'hex'), pubkey: pub1 },
          { path: "m/48'/0'/0'/2'/0/1", masterFingerprint: Buffer.from('bbbbbbbb', 'hex'), pubkey: null },
        ] as any,
        xpubMap
      )
    ).toBeUndefined();
  });
});

describe('TrezorAdapter class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    mockInit.mockResolvedValue(undefined);
    mockApiGet.mockRejectedValue(new Error('missing tx'));
    mockGetFeatures.mockResolvedValue({
      success: true,
      payload: {
        device_id: 'dev-1',
        label: 'My Trezor',
        internal_model: 'T3T1',
        pin_protection: true,
        unlocked: false,
        passphrase_protection: true,
      },
    });
    mockGetPublicKey.mockResolvedValue({
      success: true,
      payload: {
        xpub: 'xpub-from-device',
        fingerprint: 0xdeadbeef,
      },
    });
    mockSignTransaction.mockResolvedValue({
      success: true,
      payload: { serializedTx: '' },
    });
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    }
  });

  it('reports environment support based on secure context', () => {
    const adapter = new TrezorAdapter();
    expect(adapter.isSupported()).toBe(true);
    setSecureContext(false);
    expect(adapter.isSupported()).toBe(false);
  });

  it('connects successfully and exposes device state', async () => {
    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockGetFeatures).toHaveBeenCalledTimes(1);
    expect(mockGetPublicKey).toHaveBeenCalled();
    expect(device.connected).toBe(true);
    expect(device.needsPin).toBe(true);
    expect(device.needsPassphrase).toBe(true);
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getDevice()?.id).toContain('trezor-');
  });

  it('short-circuits repeated initialize calls and uses manifest fallback origin', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...originalWindow,
        isSecureContext: true,
        location: { origin: '' },
      },
      configurable: true,
    });

    const adapter = new TrezorAdapter();
    await (adapter as any).initialize();
    await (adapter as any).initialize();

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          appUrl: 'https://sanctuary.bitcoin',
        }),
      })
    );
  });

  it('initializes only once when connect is called repeatedly', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    await adapter.connect();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('maps common connect failures to user-friendly errors', async () => {
    const adapterA = new TrezorAdapter();
    mockGetFeatures.mockResolvedValueOnce({ success: false, payload: { error: 'Device not found' } });
    await expect(adapterA.connect()).rejects.toThrow('No Trezor device found');

    const adapterB = new TrezorAdapter();
    mockGetFeatures.mockImplementationOnce(async () => {
      throw new Error('Popup closed');
    });
    await expect(adapterB.connect()).rejects.toThrow('Connection cancelled by user');

    const adapterC = new TrezorAdapter();
    mockGetFeatures.mockResolvedValueOnce({ success: false, payload: {} });
    await expect(adapterC.connect()).rejects.toThrow('Failed to connect Trezor: Failed to connect to Trezor');
  });

  it('maps initialization, bridge, and generic connect failures', async () => {
    const initFailure = new TrezorAdapter();
    mockInit.mockRejectedValueOnce(new Error('init fail'));
    await expect(initFailure.connect()).rejects.toThrow(
      'Failed to initialize Trezor. Please ensure Trezor Suite is running.'
    );

    const bridgeFailure = new TrezorAdapter();
    mockGetFeatures.mockRejectedValueOnce(new Error('Bridge not running'));
    await expect(bridgeFailure.connect()).rejects.toThrow(
      'Trezor Suite bridge not running. Please open Trezor Suite desktop app.'
    );

    const genericFailure = new TrezorAdapter();
    mockGetFeatures.mockRejectedValueOnce(new Error('exploded'));
    await expect(genericFailure.connect()).rejects.toThrow('Failed to connect Trezor: exploded');

    const unknownFailure = new TrezorAdapter();
    mockGetFeatures.mockRejectedValueOnce('exploded');
    await expect(unknownFailure.connect()).rejects.toThrow('Failed to connect Trezor: Unknown error');
  });

  it('uses model fallback values when feature id/label are missing and fp request is unsuccessful', async () => {
    mockGetFeatures.mockResolvedValueOnce({
      success: true,
      payload: {
        internal_model: 'T3T1',
        pin_protection: false,
        unlocked: true,
        passphrase_protection: false,
      },
    });
    mockGetPublicKey.mockResolvedValueOnce({
      success: false,
      payload: {},
    });

    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(device.id).toBe('trezor-unknown');
    expect(device.model).toBe('Trezor Safe 5');
    expect(device.name).toBe('Trezor Safe 5');
    expect(device.fingerprint).toBeUndefined();
  });

  it('converts null pin_protection and passphrase_protection to undefined', async () => {
    mockGetFeatures.mockResolvedValueOnce({
      success: true,
      payload: {
        device_id: 'abc123',
        internal_model: 'T2B1',
        pin_protection: null,
        unlocked: true,
        passphrase_protection: null,
      },
    });
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub...' },
    });

    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(device.needsPin).toBeUndefined();
    expect(device.needsPassphrase).toBeUndefined();
  });

  it('continues connecting when fingerprint request throws an exception', async () => {
    mockGetPublicKey.mockImplementationOnce(async () => {
      throw new Error('fingerprint unavailable');
    });

    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(device.connected).toBe(true);
    expect(device.fingerprint).toBeUndefined();
    expect(adapter.isConnected()).toBe(true);
  });

  it.each([
    { model: 'T', internal_model: undefined, expected: 'Trezor Model T' },
    { model: '1', internal_model: undefined, expected: 'Trezor Model One' },
    { model: undefined, internal_model: 'T2B1', expected: 'Trezor Safe 3' },
    { model: undefined, internal_model: 'T3W1', expected: 'Trezor Safe 7' },
    { model: undefined, internal_model: undefined, expected: 'Trezor' },
  ])('maps feature payload to model name ($expected)', async ({ model, internal_model, expected }) => {
    mockGetFeatures.mockResolvedValueOnce({
      success: true,
      payload: {
        device_id: 'model-test',
        label: 'Model Device',
        model,
        internal_model,
        pin_protection: false,
        unlocked: true,
        passphrase_protection: false,
      },
    });

    const adapter = new TrezorAdapter();
    const device = await adapter.connect();
    expect(device.model).toBe(expected);
  });

  it('disconnects and clears connected state', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    await adapter.disconnect();

    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getDevice()).toBeNull();
  });

  it('requires connected state for getXpub/signPSBT', async () => {
    const adapter = new TrezorAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Trezor not connected');
    await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow('Trezor not connected');
  });

  it('returns xpub and prefers master fingerprint from connection', async () => {
    const adapter = new TrezorAdapter();
    // connect() call fingerprint
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-master', fingerprint: 0x12345678 },
    });
    await adapter.connect();

    // getXpub() call payload with different parent fingerprint
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-child', fingerprint: 0xabcdef12 },
    });
    const result = await adapter.getXpub("m/84'/0'/0'");

    expect(result.xpub).toBe('xpub-child');
    expect(result.fingerprint).toBe('12345678');
  });

  it('uses parent fingerprint fallback and testnet coin for h-notation xpub requests', async () => {
    const adapter = new TrezorAdapter();
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-master-no-fp' },
    });
    await adapter.connect();

    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'tpub-child', fingerprint: 0x01020304 },
    });
    const result = await adapter.getXpub('m/84h/1h/0h');

    expect(result.fingerprint).toBe('01020304');
    expect(mockGetPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: 'm/84h/1h/0h',
        coin: 'Testnet',
      })
    );
  });

  it('falls back to empty fingerprint when master and parent fingerprints are unavailable', async () => {
    const adapter = new TrezorAdapter();
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-master-no-fp' },
    });
    await adapter.connect();

    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-child-no-fp' },
    });
    const result = await adapter.getXpub("m/84'/0'/0'");
    expect(result.fingerprint).toBe('');
  });

  it('maps getXpub cancellation errors', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    mockGetPublicKey.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Cancelled by user' },
    });

    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request cancelled on device');
  });

  it('wraps non-cancelled getXpub failures', async () => {
    const adapterA = new TrezorAdapter();
    await adapterA.connect();
    mockGetPublicKey.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Bridge down' },
    });
    await expect(adapterA.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Bridge down'
    );

    const adapterB = new TrezorAdapter();
    await adapterB.connect();
    mockGetPublicKey.mockResolvedValueOnce({
      success: false,
      payload: {},
    });
    await expect(adapterB.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Failed to get public key'
    );

    const adapterC = new TrezorAdapter();
    await adapterC.connect();
    mockGetPublicKey.mockRejectedValueOnce('bridge-failed');
    await expect(adapterC.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Unknown error'
    );
  });

  it('signs a single-sig PSBT and passes ref transaction metadata to Trezor Connect', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt, inputScript } = createSingleSigPsbt();
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockApiGet.mockResolvedValueOnce({ hex: createRefTxHex(60000, inputScript) });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const response = await adapter.signPSBT({
      psbt: psbt.toBase64(),
      accountPath: "m/84'/0'/0'",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    expect(response.rawTx).toBe(signedTxHex);
    expect(response.signatures).toBe(1);

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Bitcoin');
    expect(call.refTxs).toHaveLength(1);
    expect(call.inputs[0]).toMatchObject({
      amount: '60000',
      script_type: 'SPENDWITNESS',
    });
    expect(call.outputs[0].script_type).toBe('PAYTOADDRESS');
  });

  it('uses request.inputPaths fallback and h-notation parsing for signPSBT', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ includeBip32Derivation: false });
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: ['m/84h/1h/0h/0/0'],
    });

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Testnet');
    expect(call.inputs[0].address_n.slice(0, 3)).toEqual([
      84 + 0x80000000,
      1 + 0x80000000,
      0 + 0x80000000,
    ]);
  });

  it('detects testnet from PSBT bip32Derivation when request paths are absent', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ inputPath: "m/84'/1'/0'/0/0" });
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: [],
    });

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Testnet');
  });

  it('maps taproot account path to taproot change output script type', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ inputPath: "m/86'/0'/0'/0/0" });
    psbt.addOutput({
      script: hexToBytes(`0014${'44'.repeat(20)}`),
      value: BigInt(500),
      bip32Derivation: [
        {
          masterFingerprint: hexToBytes('deadbeef'),
          path: "m/86'/0'/0'/1/0",
          pubkey: hexToBytes(`02${'11'.repeat(32)}`),
        },
      ],
    });

    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await adapter.signPSBT({
      psbt: psbt.toBase64(),
      accountPath: "m/86'/0'/0'",
      inputPaths: ["m/86'/0'/0'/0/0"],
    });

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
  });

  it('rejects multisig signing when this device is not a cosigner', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createMultisigPsbt(false);
    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: [],
      })
    ).rejects.toThrow('is not a cosigner for this multisig wallet');
  });

  it('extracts multisig signature from trezor raw tx into returned PSBT', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt, witnessScript, devicePubkey } = createMultisigPsbt(true);
    const signedTxHex = createSignedMultisigTxHex(psbt, witnessScript);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const response = await adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: ["m/48'/0'/0'/2'/0/1"],
      changeOutputs: [1],
      multisigXpubs: {
        deadbeef: slip132Key('04b24746'),
        aaaaaaaa: slip132Key('045f1cf6'),
      },
    });

    const updatedPsbt = bitcoin.Psbt.fromBase64(response.psbt);
    const partialSig = updatedPsbt.data.inputs[0].partialSig ?? [];
    expect(partialSig.some(sig => sig.pubkey.length === devicePubkey.length && sig.pubkey.every((v, i) => v === devicePubkey[i]))).toBe(true);

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].multisig).toBeDefined();
    expect(call.outputs[1].multisig).toBeDefined();
    expect(call.outputs[1].script_type).toBe('PAYTOWITNESS');
  });

  it.each([
    ['Cancelled', 'Transaction rejected on Trezor'],
    ['PIN invalid', 'Incorrect PIN. Please try again.'],
    ['Passphrase denied', 'Passphrase entry cancelled.'],
    ['Device disconnected', 'Trezor disconnected. Please reconnect and try again.'],
    ['Forbidden key path', 'Trezor blocked this derivation path'],
    ['Wrong derivation path', 'The derivation path does not match your Trezor account'],
    ['mystery failure', 'Failed to sign with Trezor: mystery failure'],
  ])('maps signPSBT error branch: %s', async (deviceError, expectedMessage) => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: { error: deviceError },
    });

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      })
    ).rejects.toThrow(expectedMessage);
  });

  it('uses signing fallback message when trezor error payload does not include an error string', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: {},
    });

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      })
    ).rejects.toThrow('Failed to sign with Trezor: Signing failed');
  });

  it('maps invalid PSBT errors in signPSBT catch path', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    await expect(
      adapter.signPSBT({
        psbt: 'not-a-psbt',
        inputPaths: [],
      })
    ).rejects.toThrow('Failed to sign with Trezor');
  });
});

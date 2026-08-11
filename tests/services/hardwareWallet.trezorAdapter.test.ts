/**
 * Trezor adapter coverage tests
 */

import * as bitcoin from 'bitcoinjs-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMultisigPsbt,
  createSignedMultisigTxHex,
  createSingleSigPsbt,
  hexToBytes,
  originalWindow,
  setSecureContext,
  unsignedTxHexFromPsbt,
} from './hardwareWallet/trezorAdapterTestHarness';

const mockInit = vi.fn();
const mockGetFeatures = vi.fn();
const mockGetDeviceState = vi.fn();
const mockGetPublicKey = vi.fn();
const mockGetAddress = vi.fn();
const mockSignTransaction = vi.fn();
const mockApiGet = vi.fn();
const mockValidatePsbtSigningRequest = vi.fn();
const mockValidateAndApplyTrezorSignatures = vi.fn();
const mockAssertAuthenticatedTrezorArtifact = vi.fn();

vi.mock('../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: (...args: unknown[]) => mockValidatePsbtSigningRequest(...args),
}));

vi.mock('../../src/services/hardwareWallet/adapters/trezor/signPsbtSignatures', () => ({
  validateAndApplyTrezorSignatures: (...args: unknown[]) =>
    mockValidateAndApplyTrezorSignatures(...args),
}));

vi.mock(
  '../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation')
      >();
    return {
      ...actual,
      assertAuthenticatedTrezorArtifact: (...args: unknown[]) =>
        mockAssertAuthenticatedTrezorArtifact(...args),
    };
  }
);

vi.mock('@trezor/connect-web', () => ({
  asDeviceUniquePath: (path: string) => path,
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    getFeatures: (...args: unknown[]) => mockGetFeatures(...args),
    getDeviceState: (...args: unknown[]) => mockGetDeviceState(...args),
    getPublicKey: async (...args: unknown[]) => {
      const result = await mockGetPublicKey(...args);
      return result?.success && !Object.hasOwn(result, 'device')
        ? { ...result, device: (args[0] as { device?: unknown })?.device }
        : result;
    },
    getAddress: async (...args: unknown[]) => {
      const result = await mockGetAddress(...args);
      return result?.success && !Object.hasOwn(result, 'device')
        ? { ...result, device: (args[0] as { device?: unknown })?.device }
        : result;
    },
    signTransaction: async (...args: unknown[]) => {
      const result = await mockSignTransaction(...args);
      return result?.success && !Object.hasOwn(result, 'device')
        ? { ...result, device: (args[0] as { device?: unknown })?.device }
        : result;
    },
  },
}));

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TrezorAdapter } from '../../src/services/hardwareWallet/adapters/trezor';

const requestAccountPath = (request: any, psbt: bitcoin.Psbt): string => {
  const firstPath =
    request.accountPath ||
    request.inputPaths?.[0] ||
    psbt.data.inputs[0]?.bip32Derivation?.[0]?.path ||
    "m/84'/0'/0'";
  const normalized = firstPath.replace(/h/gi, "'");
  const pathParts = normalized.split('/');
  return pathParts.slice(0, pathParts[1] === "48'" ? 5 : 4).join('/');
};

const assertSelectedMultisigCosigner = (
  psbt: bitcoin.Psbt,
  fingerprint: string,
): void => {
  const isMultisig = psbt.data.inputs.some((input) => Boolean(input.witnessScript));
  const selectedSignerPresent = psbt.data.inputs.every((input) =>
    input.bip32Derivation?.some(
      (origin) => Buffer.from(origin.masterFingerprint).toString('hex') === fingerprint
    )
  );
  if (isMultisig && !selectedSignerPresent) {
    throw new Error('connected device is not a cosigner for this multisig wallet');
  }
};

const requestChangeOutputIndexes = (request: any, psbt: bitcoin.Psbt): number[] =>
  request.changeOutputs ??
  psbt.data.outputs.flatMap((output, index) =>
    output.bip32Derivation?.length || output.tapBip32Derivation?.length ? [index] : []
  );

const validatedSigningRequest = (request: any, fingerprint: string) => {
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);
  const accountPath = requestAccountPath(request, psbt);
  assertSelectedMultisigCosigner(psbt, fingerprint);
  const isMultisig = psbt.data.inputs.some((input) => Boolean(input.witnessScript));
  const purpose = accountPath.split('/')[1];
  const changeOutputIndexes = requestChangeOutputIndexes(request, psbt);
  const network = accountPath.includes("/1'/") ? 'testnet3' : 'mainnet';
  return {
    psbt,
    context: {
      walletType: isMultisig ? 'multi_sig' : 'single_sig',
      scriptType:
        purpose === "86'" ? 'taproot' : purpose === "49'" ? 'nested_segwit' : 'native_segwit',
      inputs: psbt.txInputs.map((_, inputIndex) => ({ inputIndex })),
      network,
      changeOutputs: changeOutputIndexes.map((outputIndex: number) => ({ outputIndex })),
    },
    connectedSigner: { accountPath },
    accountPath,
    network,
    changeOutputIndexes,
  };
};

describe('TrezorAdapter class', () => {
  const selectedDevice = {
    path: 'webusb:dev-1',
    state: 'seed@device:0',
    instance: 0,
  };

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
        major_version: 2,
        minor_version: 9,
        patch_version: 6,
      },
      device: { path: selectedDevice.path, instance: selectedDevice.instance },
    });
    mockGetDeviceState.mockResolvedValue({
      success: true,
      payload: { state: selectedDevice.state },
      device: selectedDevice,
    });
    mockGetPublicKey.mockResolvedValue({
      success: true,
      payload: {
        xpub: 'xpub-from-device',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum',
        fingerprint: 0x12345678,
        depth: 3,
        childNum: 0x80000000,
      },
      device: selectedDevice,
    });
    mockGetAddress.mockResolvedValue({
      success: true,
      payload: {
        address: 'bc1qabc',
        path: [],
        serializedPath: "m/84'/0'/0'/0/0",
      },
      device: selectedDevice,
    });
    mockSignTransaction.mockResolvedValue({
      success: true,
      payload: { serializedTx: '' },
      device: selectedDevice,
    });
    mockValidatePsbtSigningRequest.mockImplementation(validatedSigningRequest);
    mockValidateAndApplyTrezorSignatures.mockImplementation((psbt: bitcoin.Psbt) => ({
      validatedPsbt: psbt,
      addedSignatures: 1,
    }));
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
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
    expect(mockGetDeviceState).toHaveBeenCalledWith({
      device: { path: selectedDevice.path, instance: 0, state: undefined },
    });
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      path: "m/84'/0'/0'",
      coin: 'Bitcoin',
      scriptType: 'SPENDWITNESS',
      showOnTrezor: false,
      device: selectedDevice,
    });
    expect(device.fingerprint).toBe('deadbeef');
    expect(device.connected).toBe(true);
    expect(device.needsPin).toBe(true);
    expect(device.needsPassphrase).toBe(true);
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getDevice()?.id).toContain('trezor-');
    expect(device.firmwareVersion).toBe('2.9.6');
    expect(device.transportVersion).toBe('9.7.3');
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

  it('supports an explicit pinned Bridge transport for protocol conformance', async () => {
    const adapter = new TrezorAdapter({
      manifest: {
        email: 'ci@sanctuary.local',
        appUrl: 'https://sanctuary.local',
        appName: 'Sanctuary Trezor Proof',
      },
      transports: ['BridgeTransport'],
      pendingTransportEvent: false,
      debug: false,
    });

    await adapter.connect();

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        transports: ['BridgeTransport'],
        pendingTransportEvent: false,
        debug: false,
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
    mockGetFeatures.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Device not found' },
    });
    await expect(adapterA.connect()).rejects.toThrow('No Trezor device found');

    const adapterB = new TrezorAdapter();
    mockGetFeatures.mockImplementationOnce(async () => {
      throw new Error('Popup closed');
    });
    await expect(adapterB.connect()).rejects.toThrow('Connection cancelled by user');

    const adapterC = new TrezorAdapter();
    mockGetFeatures.mockResolvedValueOnce({ success: false, payload: {} });
    await expect(adapterC.connect()).rejects.toThrow(
      'Failed to connect Trezor: Failed to connect to Trezor'
    );
  });

  it.each([
    [{ error: 'Device state unavailable' }, 'Device state unavailable'],
    [{ code: 'Failure' }, 'Failed to resolve selected Trezor session'],
  ])(
    'fails closed when the selected device state cannot be resolved %#',
    async (payload, message) => {
      mockGetDeviceState.mockResolvedValueOnce({ success: false, payload });

      const adapter = new TrezorAdapter();
      await expect(adapter.connect()).rejects.toThrow(message);
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getDevice()).toBeNull();
    }
  );

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
    await expect(unknownFailure.connect()).rejects.toThrow(
      'Failed to connect Trezor: Unknown error'
    );
  });

  it('uses model fallback values when feature id and label are missing', async () => {
    mockGetFeatures.mockResolvedValueOnce({
      success: true,
      payload: {
        internal_model: 'T3T1',
        pin_protection: false,
        unlocked: true,
        passphrase_protection: false,
      },
      device: { path: selectedDevice.path, instance: 0 },
    });
    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(device.id).toBe('trezor-unknown');
    expect(device.model).toBe('Trezor Safe 5');
    expect(device.name).toBe('Trezor Safe 5');
    expect(device.fingerprint).toBe('deadbeef');
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
      device: { path: selectedDevice.path, instance: 0 },
    });
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: {
        xpub: 'xpub...',
        descriptor: 'wpkh([12345678/84h/0h/0h]xpub.../<0;1>/*)#checksum',
        fingerprint: 0,
        depth: 3,
        childNum: 0x80000000,
      },
    });

    const adapter = new TrezorAdapter();
    const device = await adapter.connect();

    expect(device.needsPin).toBeUndefined();
    expect(device.needsPassphrase).toBeUndefined();
  });

  it('fails closed when the master fingerprint request throws', async () => {
    mockGetPublicKey.mockImplementationOnce(async () => {
      throw new Error('fingerprint unavailable');
    });

    const adapter = new TrezorAdapter();
    await expect(adapter.connect()).rejects.toThrow('master fingerprint');
    expect(adapter.isConnected()).toBe(false);
  });

  it('normalizes a non-Error master fingerprint failure without retaining a connection', async () => {
    mockGetPublicKey.mockRejectedValueOnce('transport failed');

    const adapter = new TrezorAdapter();
    await expect(adapter.connect()).rejects.toThrow(
      'Trezor master fingerprint unavailable: Unknown error'
    );
    expect(adapter.isConnected()).toBe(false);
  });

  it.each([
    { success: false, payload: {} },
    {
      success: true,
      payload: {
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-root/<0;1>/*)',
        depth: 2,
        childNum: 0x80000000,
      },
    },
    {
      success: true,
      payload: {
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-root/<0;1>/*)',
        depth: 3,
        childNum: 0,
      },
    },
    {
      success: true,
      payload: {
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/1h]xpub-root/<0;1>/*)',
        depth: 3,
        childNum: 0x80000000,
      },
    },
    {
      success: true,
      payload: {
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]other-xpub/<0;1>/*)',
        depth: 3,
        childNum: 0x80000000,
      },
    },
    { success: true, payload: { depth: 3, childNum: 0x80000000 } },
  ])('rejects missing or sentinel master fingerprint payload %#', async (response) => {
    mockGetPublicKey.mockResolvedValueOnce(response);

    const adapter = new TrezorAdapter();
    await expect(adapter.connect()).rejects.toThrow('master fingerprint');
    expect(adapter.isConnected()).toBe(false);
  });

  it.each([
    { model: 'T', internal_model: undefined, expected: 'Trezor Model T' },
    { model: '1', internal_model: undefined, expected: 'Trezor Model One' },
    { model: undefined, internal_model: 'T2B1', expected: 'Trezor Safe 3' },
    { model: undefined, internal_model: 'T3W1', expected: 'Trezor Safe 7' },
    { model: undefined, internal_model: undefined, expected: 'Trezor' },
  ])(
    'maps feature payload to model name ($expected)',
    async ({ model, internal_model, expected }) => {
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
        device: { path: selectedDevice.path, instance: 0 },
      });

      const adapter = new TrezorAdapter();
      const device = await adapter.connect();
      expect(device.model).toBe(expected);
    }
  );

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
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'Trezor not connected'
    );
    await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow(
      'Trezor not connected'
    );
  });

  it('requires the selected session for connected xpub and address operations', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    (adapter as any).connection.session = undefined;

    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Trezor selected session is unavailable'
    );
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'Trezor selected session is unavailable'
    );
  });

  it('returns xpub and prefers master fingerprint from connection', async () => {
    const adapter = new TrezorAdapter();
    // connect() call fingerprint
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: {
        xpub: 'xpub-master',
        descriptor: 'wpkh([12345678/84h/0h/0h]xpub-master/<0;1>/*)#checksum',
        fingerprint: 0,
        depth: 3,
        childNum: 0x80000000,
      },
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

  it('invalidates the selected session when Connect omits response identity', async () => {
    const xpubAdapter = new TrezorAdapter();
    await xpubAdapter.connect();
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: 'xpub-child', fingerprint: 0xabcdef12 },
      device: undefined,
    });
    await expect(xpubAdapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(xpubAdapter.isConnected()).toBe(false);

    const addressAdapter = new TrezorAdapter();
    await addressAdapter.connect();
    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: { address: 'bc1qabc' },
      device: undefined,
    });
    await expect(addressAdapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(addressAdapter.isConnected()).toBe(false);

    const signingAdapter = new TrezorAdapter();
    await signingAdapter.connect();
    const { psbt } = createSingleSigPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: unsignedTxHexFromPsbt(psbt), signatures: [] },
      device: undefined,
    });
    await expect(signingAdapter.signPSBT({ psbt: psbt.toBase64() })).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(signingAdapter.isConnected()).toBe(false);
  });

  it('does not substitute an account-parent fingerprint for missing master identity', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    (adapter as any).connection.fingerprint = undefined;

    await expect(adapter.getXpub('m/84h/1h/0h')).rejects.toThrow('master fingerprint');
    expect(mockGetPublicKey).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty account xpub instead of returning incomplete evidence', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: '', fingerprint: 0x01020304 },
    });
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('empty xpub');
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

  it('verifies an address on the Trezor display and compares the returned address', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: {
        address: 'tb1qexpected',
        path: [],
        serializedPath: 'm/84h/1h/0h/0/0',
      },
    });

    await expect(adapter.verifyAddress('m/84h/1h/0h/0/0', 'tb1qexpected')).resolves.toBe(true);
    expect(mockGetAddress).toHaveBeenLastCalledWith({
      path: 'm/84h/1h/0h/0/0',
      address: 'tb1qexpected',
      showOnTrezor: true,
      coin: 'Testnet',
      scriptType: 'SPENDWITNESS',
      device: selectedDevice,
    });

    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: {
        address: 'tb1qmismatch',
        path: [],
        serializedPath: 'm/84h/1h/0h/0/0',
      },
    });

    await expect(adapter.verifyAddress('m/84h/1h/0h/0/0', 'tb1qexpected')).resolves.toBe(false);
  });

  it('maps Trezor address display rejection and failures', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    mockGetAddress.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Cancelled by user' },
    });
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).resolves.toBe(false);

    mockGetAddress.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Bridge down' },
    });
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Bridge down'
    );

    mockGetAddress.mockResolvedValueOnce({
      success: false,
      payload: {},
    });
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Failed to verify address'
    );

    mockGetAddress.mockRejectedValueOnce('bridge-failed');
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Unknown error'
    );
  });

  it('signs a single-sig PSBT and passes ref transaction metadata to Trezor Connect', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt, refTxHex } = createSingleSigPsbt();
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockApiGet.mockResolvedValueOnce({
      hex: refTxHex,
    });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const response = await adapter.signPSBT({
      psbt: psbt.toBase64(),
      walletId: 'wallet-1',
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

  it('rejects a PSBT input that has no bound derivation instead of using request.inputPaths', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ includeBip32Derivation: false });
    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ['m/84h/1h/0h/0/0'],
      })
    ).rejects.toThrow(/missing wallet-bound BIP32 derivation/i);
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it('blocks Payjoin when a receiver-added presigned input is not owned by the selected Trezor', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt } = createSingleSigPsbt();
    psbt.addInput({
      hash: '44'.repeat(32),
      index: 1,
      witnessUtxo: {
        script: hexToBytes(`0014${'55'.repeat(20)}`),
        value: 7_000n,
      },
      finalScriptWitness: Uint8Array.from([0]),
    });

    await expect(
      adapter.signPSBT({
      psbt: psbt.toBase64(),
        walletId: 'wallet-1',
      })
    ).rejects.toThrow(/missing wallet-bound BIP32 derivation/i);
    expect(mockSignTransaction).not.toHaveBeenCalled();
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
    const input = psbt.data.inputs[0] as any;
    delete input.bip32Derivation;
    input.tapBip32Derivation = [
      {
        masterFingerprint: hexToBytes('deadbeef'),
        path: "m/86'/0'/0'/0/0",
        pubkey: hexToBytes('11'.repeat(32)),
        leafHashes: [],
      },
    ];
    psbt.addOutput({
      script: hexToBytes(`0014${'44'.repeat(20)}`),
      value: BigInt(500),
      tapBip32Derivation: [
        {
          masterFingerprint: hexToBytes('deadbeef'),
          path: "m/86'/0'/0'/1/0",
          pubkey: hexToBytes('11'.repeat(32)),
          leafHashes: [],
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

  it('returns the honest native Trezor tuple and the cryptographically applied multisig PSBT', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    const { psbt, witnessScript, multisigXpubs } = createMultisigPsbt(true);
    const signedTxHex = createSignedMultisigTxHex(psbt, witnessScript);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex, signatures: ['300102'] },
    });

    const response = await adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: ["m/48'/0'/0'/2'/0/1"],
      changeOutputs: [1],
      multisigXpubs,
    });

    expect(response.psbt).toBe(psbt.toBase64());
    expect(response.rawTx).toBeUndefined();
    expect(response.trezorArtifact).toEqual({
      type: 'trezor-connect-transaction',
      sourcePsbt: psbt.toBase64(),
      connectSignatures: ['300102'],
      serializedTx: signedTxHex,
    });

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].multisig).toBeDefined();
    expect(call.outputs[1].multisig).toBeDefined();
    expect(call.outputs[1].script_type).toBe('PAYTOWITNESS');
  });

  it('rejects partial multisig account xpub evidence before calling Trezor', async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    const { psbt, multisigXpubs } = createMultisigPsbt(true);

    await expect(
      adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: ["m/48'/0'/0'/2'/0/1"],
      multisigXpubs: {
          deadbeef: multisigXpubs.deadbeef,
      },
      })
    ).rejects.toThrow(/missing account xpub evidence.*aaaaaaaa/i);
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

});

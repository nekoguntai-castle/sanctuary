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
import {
  connectFail,
  connectOk,
  createFakeTrezorClient,
  type FakeTrezorClient,
} from './hardwareWallet/trezorFakeClient';

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
import type {
  TrezorCallResult,
  TrezorPublicKey,
} from '../../src/services/hardwareWallet/adapters/trezor/types';

const lastSignCall = (client: FakeTrezorClient) => {
  const call = client.signTransaction.mock.calls.at(-1)?.[0];
  if (!call) throw new Error('expected signTransaction to have been called');
  return call;
};

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

  let client: FakeTrezorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    client = createFakeTrezorClient();
    mockApiGet.mockRejectedValue(new Error('missing tx'));
    client.getFeatures.mockResolvedValue(
      connectOk(
        {
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
        { path: selectedDevice.path, instance: selectedDevice.instance }
      )
    );
    client.getDeviceState.mockResolvedValue(
      connectOk({ state: selectedDevice.state }, selectedDevice)
    );
    client.getPublicKey.mockResolvedValue(
      connectOk(
        {
          xpub: 'xpub-from-device',
          descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum',
          fingerprint: 0x12345678,
          depth: 3,
          childNum: 0x80000000,
        },
        selectedDevice
      )
    );
    client.getAddress.mockResolvedValue(connectOk({ address: 'bc1qabc' }, selectedDevice));
    client.signTransaction.mockResolvedValue(connectOk({ serializedTx: '' }, selectedDevice));
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
    const adapter = new TrezorAdapter(client);
    expect(adapter.isSupported()).toBe(true);
    setSecureContext(false);
    expect(adapter.isSupported()).toBe(false);
  });

  it('connects successfully and exposes device state', async () => {
    const adapter = new TrezorAdapter(client);
    const device = await adapter.connect();

    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    expect(client.getDeviceState).toHaveBeenCalledWith({
      device: { path: selectedDevice.path, instance: 0, state: undefined },
    });
    expect(client.getPublicKey).toHaveBeenCalledWith({
      path: "m/84'/0'/0'",
      network: 'mainnet',
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

  it('short-circuits repeated initialize calls', async () => {
    const adapter = new TrezorAdapter(client);
    await (adapter as any).initialize();
    await (adapter as any).initialize();

    expect(client.init).toHaveBeenCalledTimes(1);
  });

  // Init settings (manifest origin fallback, pinned Bridge transport) now belong to
  // createConnectWebClient(settings); hardwareWallet.trezorConnectClient.test.ts pins them.
  // The adapter's part of the contract is that it initializes through the injected client.
  it('initializes through the injected client when connecting', async () => {
    const adapter = new TrezorAdapter(client);

    await adapter.connect();

    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledWith();
  });

  it('initializes only once when connect is called repeatedly', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    await adapter.connect();
    expect(client.init).toHaveBeenCalledTimes(1);
  });

  it('maps common connect failures to user-friendly errors', async () => {
    const adapterA = new TrezorAdapter(client);
    client.getFeatures.mockResolvedValueOnce(connectFail('Device not found'));
    await expect(adapterA.connect()).rejects.toThrow('No Trezor device found');

    const adapterB = new TrezorAdapter(client);
    client.getFeatures.mockImplementationOnce(async () => {
      throw new Error('Popup closed');
    });
    await expect(adapterB.connect()).rejects.toThrow('Connection cancelled by user');

    const adapterC = new TrezorAdapter(client);
    client.getFeatures.mockResolvedValueOnce(connectFail());
    await expect(adapterC.connect()).rejects.toThrow(
      'Failed to connect Trezor: Failed to connect to Trezor'
    );
  });

  it.each([
    [connectFail('Device state unavailable'), 'Device state unavailable'],
    [connectFail(undefined, 'Failure'), 'Failed to resolve selected Trezor session'],
  ])(
    'fails closed when the selected device state cannot be resolved %#',
    async (failure, message) => {
      client.getDeviceState.mockResolvedValueOnce(failure);

      const adapter = new TrezorAdapter(client);
      await expect(adapter.connect()).rejects.toThrow(message);
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getDevice()).toBeNull();
    }
  );

  it('maps initialization, bridge, and generic connect failures', async () => {
    const initFailure = new TrezorAdapter(client);
    client.init.mockRejectedValueOnce(new Error('init fail'));
    await expect(initFailure.connect()).rejects.toThrow(
      'Failed to initialize Trezor. Please ensure Trezor Suite is running.'
    );

    const bridgeFailure = new TrezorAdapter(client);
    client.getFeatures.mockRejectedValueOnce(new Error('Bridge not running'));
    await expect(bridgeFailure.connect()).rejects.toThrow(
      'Trezor Suite bridge not running. Please open Trezor Suite desktop app.'
    );

    const genericFailure = new TrezorAdapter(client);
    client.getFeatures.mockRejectedValueOnce(new Error('exploded'));
    await expect(genericFailure.connect()).rejects.toThrow('Failed to connect Trezor: exploded');

    const unknownFailure = new TrezorAdapter(client);
    client.getFeatures.mockRejectedValueOnce('exploded');
    await expect(unknownFailure.connect()).rejects.toThrow(
      'Failed to connect Trezor: Unknown error'
    );
  });

  it('uses model fallback values when feature id and label are missing', async () => {
    client.getFeatures.mockResolvedValueOnce(connectOk({
        internal_model: 'T3T1',
        pin_protection: false,
        unlocked: true,
        passphrase_protection: false,
      }, { path: selectedDevice.path, instance: 0 }));
    const adapter = new TrezorAdapter(client);
    const device = await adapter.connect();

    expect(device.id).toBe('trezor-unknown');
    expect(device.model).toBe('Trezor Safe 5');
    expect(device.name).toBe('Trezor Safe 5');
    expect(device.fingerprint).toBe('deadbeef');
  });

  it('converts null pin_protection and passphrase_protection to undefined', async () => {
    client.getFeatures.mockResolvedValueOnce(connectOk({
        device_id: 'abc123',
        internal_model: 'T2B1',
        pin_protection: null,
        unlocked: true,
        passphrase_protection: null,
      }, { path: selectedDevice.path, instance: 0 }));
    client.getPublicKey.mockResolvedValueOnce(connectOk({
        xpub: 'xpub...',
        descriptor: 'wpkh([12345678/84h/0h/0h]xpub.../<0;1>/*)#checksum',
        fingerprint: 0,
        depth: 3,
        childNum: 0x80000000,
      }, selectedDevice));

    const adapter = new TrezorAdapter(client);
    const device = await adapter.connect();

    expect(device.needsPin).toBeUndefined();
    expect(device.needsPassphrase).toBeUndefined();
  });

  it('fails closed when the master fingerprint request throws', async () => {
    client.getPublicKey.mockImplementationOnce(async () => {
      throw new Error('fingerprint unavailable');
    });

    const adapter = new TrezorAdapter(client);
    await expect(adapter.connect()).rejects.toThrow('master fingerprint');
    expect(adapter.isConnected()).toBe(false);
  });

  it('normalizes a non-Error master fingerprint failure without retaining a connection', async () => {
    client.getPublicKey.mockRejectedValueOnce('transport failed');

    const adapter = new TrezorAdapter(client);
    await expect(adapter.connect()).rejects.toThrow(
      'Trezor master fingerprint unavailable: Unknown error'
    );
    expect(adapter.isConnected()).toBe(false);
  });

  it.each([
    connectFail(),
    connectOk({
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-root/<0;1>/*)',
        depth: 2,
        childNum: 0x80000000,
      }, selectedDevice),
    connectOk({
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-root/<0;1>/*)',
        depth: 3,
        childNum: 0,
      }, selectedDevice),
    connectOk({
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/1h]xpub-root/<0;1>/*)',
        depth: 3,
        childNum: 0x80000000,
      }, selectedDevice),
    connectOk({
        xpub: 'xpub-root',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]other-xpub/<0;1>/*)',
        depth: 3,
        childNum: 0x80000000,
      }, selectedDevice),
    connectOk({ depth: 3, childNum: 0x80000000 }, selectedDevice),
  ])('rejects missing or sentinel master fingerprint payload %#', async (response) => {
    client.getPublicKey.mockResolvedValueOnce(response);

    const adapter = new TrezorAdapter(client);
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
      client.getFeatures.mockResolvedValueOnce(connectOk({
          device_id: 'model-test',
          label: 'Model Device',
          model,
          internal_model,
          pin_protection: false,
          unlocked: true,
          passphrase_protection: false,
        }, { path: selectedDevice.path, instance: 0 }));

      const adapter = new TrezorAdapter(client);
      const device = await adapter.connect();
      expect(device.model).toBe(expected);
    }
  );

  it('disconnects and clears connected state', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    await adapter.disconnect();

    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getDevice()).toBeNull();
  });

  it('cancels a connect() that resolves after a concurrent disconnect() and does not resurrect the session', async () => {
    let resolvePublicKey: ((value: TrezorCallResult<TrezorPublicKey>) => void) | undefined;
    client.getPublicKey.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePublicKey = resolve;
      })
    );
    const adapter = new TrezorAdapter(client);

    const connectPromise = adapter.connect();
    await adapter.disconnect();
    resolvePublicKey?.(connectOk({
        xpub: 'xpub-from-device',
        descriptor: 'wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum',
        fingerprint: 0x12345678,
        depth: 3,
        childNum: 0x80000000,
      }, selectedDevice));

    await expect(connectPromise).rejects.toThrow(/cancel/i);
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getDevice()).toBeNull();
  });

  it('requires connected state for getXpub/signPSBT', async () => {
    const adapter = new TrezorAdapter(client);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Trezor not connected');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'Trezor not connected'
    );
    await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow(
      'Trezor not connected'
    );
  });

  it('requires the selected session for connected xpub and address operations', async () => {
    const adapter = new TrezorAdapter(client);
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
    const adapter = new TrezorAdapter(client);
    // connect() call fingerprint
    client.getPublicKey.mockResolvedValueOnce(connectOk({
        xpub: 'xpub-master',
        descriptor: 'wpkh([12345678/84h/0h/0h]xpub-master/<0;1>/*)#checksum',
        fingerprint: 0,
        depth: 3,
        childNum: 0x80000000,
      }, selectedDevice));
    await adapter.connect();

    // getXpub() call payload with different parent fingerprint
    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: 'xpub-child', fingerprint: 0xabcdef12 }, selectedDevice));
    const result = await adapter.getXpub("m/84'/0'/0'");

    expect(result.xpub).toBe('xpub-child');
    expect(result.fingerprint).toBe('12345678');
  });

  it('invalidates the selected session when Connect omits response identity', async () => {
    const xpubAdapter = new TrezorAdapter(client);
    await xpubAdapter.connect();
    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: 'xpub-child', fingerprint: 0xabcdef12 }));
    await expect(xpubAdapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(xpubAdapter.isConnected()).toBe(false);

    const addressAdapter = new TrezorAdapter(client);
    await addressAdapter.connect();
    client.getAddress.mockResolvedValueOnce(connectOk({ address: 'bc1qabc' }));
    await expect(addressAdapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(addressAdapter.isConnected()).toBe(false);

    const signingAdapter = new TrezorAdapter(client);
    await signingAdapter.connect();
    const { psbt } = createSingleSigPsbt();
    client.signTransaction.mockResolvedValueOnce(connectOk({ serializedTx: unsignedTxHexFromPsbt(psbt), signatures: [] }));
    await expect(signingAdapter.signPSBT({ psbt: psbt.toBase64() })).rejects.toThrow(
      'omitted the response device identity'
    );
    expect(signingAdapter.isConnected()).toBe(false);
  });

  it('does not substitute an account-parent fingerprint for missing master identity', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    (adapter as any).connection.fingerprint = undefined;

    await expect(adapter.getXpub('m/84h/1h/0h')).rejects.toThrow('master fingerprint');
    expect(client.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty account xpub instead of returning incomplete evidence', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: '', fingerprint: 0x01020304 }, selectedDevice));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('empty xpub');
  });

  it('maps getXpub cancellation errors', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    client.getPublicKey.mockResolvedValueOnce(connectFail('Cancelled by user'));

    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request cancelled on device');
  });

  it('wraps non-cancelled getXpub failures', async () => {
    const adapterA = new TrezorAdapter(client);
    await adapterA.connect();
    client.getPublicKey.mockResolvedValueOnce(connectFail('Bridge down'));
    await expect(adapterA.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Bridge down'
    );

    const adapterB = new TrezorAdapter(client);
    await adapterB.connect();
    client.getPublicKey.mockResolvedValueOnce(connectFail());
    await expect(adapterB.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Failed to get public key'
    );

    const adapterC = new TrezorAdapter(client);
    await adapterC.connect();
    client.getPublicKey.mockRejectedValueOnce('bridge-failed');
    await expect(adapterC.getXpub("m/84'/0'/0'")).rejects.toThrow(
      'Failed to get xpub from Trezor: Unknown error'
    );
  });

  it('verifies an address on the Trezor display and compares the returned address', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    client.getAddress.mockResolvedValueOnce(connectOk({
        address: 'tb1qexpected',
      }, selectedDevice));

    await expect(adapter.verifyAddress('m/84h/1h/0h/0/0', 'tb1qexpected')).resolves.toBe(true);
    expect(client.getAddress).toHaveBeenLastCalledWith({
      path: 'm/84h/1h/0h/0/0',
      address: 'tb1qexpected',
      showOnTrezor: true,
      network: 'testnet',
      scriptType: 'SPENDWITNESS',
      device: selectedDevice,
    });

    client.getAddress.mockResolvedValueOnce(connectOk({
        address: 'tb1qmismatch',
      }, selectedDevice));

    await expect(adapter.verifyAddress('m/84h/1h/0h/0/0', 'tb1qexpected')).resolves.toBe(false);
  });

  it('maps Trezor address display rejection and failures', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    client.getAddress.mockResolvedValueOnce(connectFail('Cancelled by user'));
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).resolves.toBe(false);

    client.getAddress.mockResolvedValueOnce(connectFail('Bridge down'));
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Bridge down'
    );

    client.getAddress.mockResolvedValueOnce(connectFail());
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Failed to verify address'
    );

    client.getAddress.mockRejectedValueOnce('bridge-failed');
    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).rejects.toThrow(
      'Failed to verify address on Trezor: Unknown error'
    );
  });

  it('signs a single-sig PSBT and passes ref transaction metadata to Trezor Connect', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    const { psbt, refTxHex } = createSingleSigPsbt();
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    mockApiGet.mockResolvedValueOnce({
      hex: refTxHex,
    });
    client.signTransaction.mockResolvedValueOnce(connectOk({ serializedTx: signedTxHex }, selectedDevice));

    const response = await adapter.signPSBT({
      psbt: psbt.toBase64(),
      walletId: 'wallet-1',
      accountPath: "m/84'/0'/0'",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    expect(response.rawTx).toBe(signedTxHex);
    expect(response.signatures).toBe(1);

    const call = lastSignCall(client);
    expect(call.network).toBe('mainnet');
    expect(call.refTxs).toHaveLength(1);
    expect(call.inputs[0]).toMatchObject({
      amount: '60000',
      script_type: 'SPENDWITNESS',
    });
    expect(call.outputs[0].script_type).toBe('PAYTOADDRESS');
  });

  it('rejects a PSBT input that has no bound derivation instead of using request.inputPaths', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ includeBip32Derivation: false });
    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ['m/84h/1h/0h/0/0'],
      })
    ).rejects.toThrow(/missing wallet-bound BIP32 derivation/i);
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

  it('blocks Payjoin when a receiver-added presigned input is not owned by the selected Trezor', async () => {
    const adapter = new TrezorAdapter(client);
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
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

  it('detects testnet from PSBT bip32Derivation when request paths are absent', async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    const { psbt } = createSingleSigPsbt({ inputPath: "m/84'/1'/0'/0/0" });
    const signedTxHex = unsignedTxHexFromPsbt(psbt);
    client.signTransaction.mockResolvedValueOnce(connectOk({ serializedTx: signedTxHex }, selectedDevice));

    await adapter.signPSBT({
      psbt: psbt.toBase64(),
      inputPaths: [],
    });

    const call = lastSignCall(client);
    expect(call.network).toBe('testnet');
  });

  it('maps taproot account path to taproot change output script type', async () => {
    const adapter = new TrezorAdapter(client);
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
    client.signTransaction.mockResolvedValueOnce(connectOk({ serializedTx: signedTxHex }, selectedDevice));

    await adapter.signPSBT({
      psbt: psbt.toBase64(),
      accountPath: "m/86'/0'/0'",
      inputPaths: ["m/86'/0'/0'/0/0"],
    });

    const call = lastSignCall(client);
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
  });

  it('rejects multisig signing when this device is not a cosigner', async () => {
    const adapter = new TrezorAdapter(client);
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
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    const { psbt, witnessScript, multisigXpubs } = createMultisigPsbt(true);
    const signedTxHex = createSignedMultisigTxHex(psbt, witnessScript);
    client.signTransaction.mockResolvedValueOnce(connectOk({ serializedTx: signedTxHex, signatures: ['300102'] }, selectedDevice));

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

    const call = lastSignCall(client);
    expect(call.inputs[0]).toMatchObject({ multisig: expect.anything() });
    expect(call.outputs[1]).toMatchObject({ multisig: expect.anything() });
    expect(call.outputs[1].script_type).toBe('PAYTOWITNESS');
  });

  it('rejects partial multisig account xpub evidence before calling Trezor', async () => {
    const adapter = new TrezorAdapter(client);
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
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  getFeatures: vi.fn(),
  getDeviceState: vi.fn(),
  getPublicKey: vi.fn(),
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
  asDeviceUniquePath: vi.fn((path: string) => `branded:${path}`),
}));

vi.mock('@trezor/connect-web', () => ({
  default: {
    init: sdk.init,
    getFeatures: sdk.getFeatures,
    getDeviceState: sdk.getDeviceState,
    getPublicKey: sdk.getPublicKey,
    getAddress: sdk.getAddress,
    signTransaction: sdk.signTransaction,
  },
  asDeviceUniquePath: sdk.asDeviceUniquePath,
}));

import {
  TREZOR_CONNECT_VERSION,
  connectCoin,
  createConnectWebClient,
  normalizeConnectResult,
  toConnectDevice,
} from '../../src/services/hardwareWallet/adapters/trezor/connectClient';
import type { TrezorDeviceIdentity } from '../../src/services/hardwareWallet/adapters/trezor/types';

const device: TrezorDeviceIdentity = { path: '1', state: 'state-1', instance: 0 };
const brandedDevice = { path: 'branded:1', state: 'state-1', instance: 0 };
const responseDevice = { path: '1', state: 'state-1', instance: 0 };

describe('Trezor Connect boundary client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the Connect version the adapter reports', () => {
    expect(TREZOR_CONNECT_VERSION).toBe('9.7.3');
  });

  describe('normalizeConnectResult', () => {
    it('passes a successful payload and the response device through', () => {
      expect(
        normalizeConnectResult({ success: true, payload: { xpub: 'x' }, device: responseDevice })
      ).toEqual({ ok: true, value: { xpub: 'x' }, device: responseDevice });
    });

    it('keeps a missing response device undefined so identity checks fail closed', () => {
      expect(normalizeConnectResult({ success: true, payload: {} })).toEqual({
        ok: true,
        value: {},
        device: undefined,
      });
    });

    it('reads the Connect 9 failure shape', () => {
      expect(
        normalizeConnectResult({ success: false, payload: { error: 'Popup closed', code: 'X' } })
      ).toEqual({ ok: false, error: { message: 'Popup closed', code: 'X' } });
    });

    it('reports no message when Connect 9 omits the error so callers keep their fallback', () => {
      expect(normalizeConnectResult({ success: false, payload: {} })).toEqual({
        ok: false,
        error: { message: undefined, code: undefined },
      });
      expect(normalizeConnectResult({ success: false })).toEqual({
        ok: false,
        error: { message: undefined, code: undefined },
      });
    });

    it('reads the Connect 10 failure shape', () => {
      expect(
        normalizeConnectResult({
          success: false,
          error: { message: 'Canceled', code: 'Method_Cancel' },
        })
      ).toEqual({ ok: false, error: { message: 'Canceled', code: 'Method_Cancel' } });
    });

    it('ignores non-string error fields instead of throwing', () => {
      expect(normalizeConnectResult({ success: false, error: null })).toEqual({
        ok: false,
        error: { message: undefined, code: undefined },
      });
      expect(normalizeConnectResult({ success: false, error: { message: 42, code: {} } })).toEqual({
        ok: false,
        error: { message: undefined, code: undefined },
      });
    });
  });

  it('maps every network to a Connect coin', () => {
    expect(connectCoin('mainnet')).toBe('Bitcoin');
    expect(connectCoin('testnet')).toBe('Testnet');
    expect(connectCoin('regtest')).toBe('Regtest');
  });

  it('brands the device path and keeps state and instance', () => {
    expect(toConnectDevice({ path: '7', state: undefined, instance: 2 })).toEqual({
      path: 'branded:7',
      state: undefined,
      instance: 2,
    });
  });

  describe('createConnectWebClient', () => {
    it('initializes with explicit settings when given', async () => {
      const settings = { manifest: { email: 'e', appUrl: 'https://u', appName: 'N' } };
      await createConnectWebClient(settings).init();
      expect(sdk.init).toHaveBeenCalledWith(settings);
    });

    it('initializes with the production defaults from the page origin', async () => {
      vi.stubGlobal('window', { location: { origin: 'https://node.local' } });
      try {
        await createConnectWebClient().init();
        vi.stubGlobal('window', { location: { origin: '' } });
        await createConnectWebClient().init();
      } finally {
        vi.unstubAllGlobals();
      }
      const expected = (appUrl: string) => ({
        manifest: { email: 'support@sanctuary.bitcoin', appUrl, appName: 'Sanctuary' },
        coreMode: 'auto',
        debug: true,
        lazyLoad: false,
      });
      expect(sdk.init).toHaveBeenNthCalledWith(1, expected('https://node.local'));
      expect(sdk.init).toHaveBeenNthCalledWith(2, expected('https://sanctuary.bitcoin'));
    });

    it('propagates an init failure', async () => {
      sdk.init.mockRejectedValueOnce(new Error('no core'));
      await expect(createConnectWebClient().init()).rejects.toThrow('no core');
    });

    it('normalizes getFeatures', async () => {
      sdk.getFeatures.mockResolvedValueOnce({
        success: true,
        payload: { model: 'T' },
        device: responseDevice,
      });
      await expect(createConnectWebClient().getFeatures()).resolves.toEqual({
        ok: true,
        value: { model: 'T' },
        device: responseDevice,
      });
    });

    it('brands the device for getDeviceState', async () => {
      sdk.getDeviceState.mockResolvedValueOnce({ success: false, payload: { error: 'gone' } });
      await expect(createConnectWebClient().getDeviceState({ device })).resolves.toEqual({
        ok: false,
        error: { message: 'gone', code: undefined },
      });
      expect(sdk.getDeviceState).toHaveBeenCalledWith({ device: brandedDevice });
    });

    it('maps network to coin for getPublicKey', async () => {
      sdk.getPublicKey.mockResolvedValueOnce({ success: true, payload: { xpub: 'tpub' } });
      await createConnectWebClient().getPublicKey({
        path: "m/84'/1'/0'",
        network: 'testnet',
        scriptType: 'SPENDWITNESS',
        showOnTrezor: false,
        device,
      });
      expect(sdk.getPublicKey).toHaveBeenCalledWith({
        path: "m/84'/1'/0'",
        coin: 'Testnet',
        scriptType: 'SPENDWITNESS',
        showOnTrezor: false,
        device: brandedDevice,
      });
    });

    it('maps network to coin for getAddress', async () => {
      sdk.getAddress.mockResolvedValueOnce({ success: true, payload: { address: 'bc1q' } });
      await createConnectWebClient().getAddress({
        path: "m/84'/0'/0'/0/0",
        address: 'bc1q',
        network: 'mainnet',
        scriptType: 'SPENDWITNESS',
        showOnTrezor: true,
        device,
      });
      expect(sdk.getAddress).toHaveBeenCalledWith({
        path: "m/84'/0'/0'/0/0",
        address: 'bc1q',
        coin: 'Bitcoin',
        scriptType: 'SPENDWITNESS',
        showOnTrezor: true,
        device: brandedDevice,
      });
    });

    it('never pushes a signed transaction and passes payloads through unchanged', async () => {
      sdk.signTransaction.mockResolvedValueOnce({
        success: true,
        payload: { serializedTx: '00', signatures: ['30'] },
        device: responseDevice,
      });
      const inputs = [
        { address_n: [1], prev_hash: 'aa', prev_index: 0, script_type: 'SPENDWITNESS' as const },
      ];
      const outputs = [{ address: 'bc1q', amount: '1', script_type: 'PAYTOADDRESS' as const }];
      await expect(
        createConnectWebClient().signTransaction({
          inputs,
          outputs,
          refTxs: undefined,
          network: 'mainnet',
          version: 2,
          locktime: 0,
          device,
        })
      ).resolves.toEqual({
        ok: true,
        value: { serializedTx: '00', signatures: ['30'] },
        device: responseDevice,
      });
      expect(sdk.signTransaction).toHaveBeenCalledWith({
        inputs,
        outputs,
        refTxs: undefined,
        version: 2,
        locktime: 0,
        coin: 'Bitcoin',
        push: false,
        device: brandedDevice,
      });
    });
  });
});

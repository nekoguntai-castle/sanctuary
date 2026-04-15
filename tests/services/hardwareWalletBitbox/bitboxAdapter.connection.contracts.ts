import { describe, expect, it, vi } from 'vitest';

import {
  MockBitBox02API,
  constants,
  createBitBoxAdapter,
  makeHidDevice,
  mockApiConnect,
  mockFirmwareProduct,
  mockGetDevicePath,
  setAuthorizedHidDevices,
  setWebHidEnv,
} from './bitboxAdapterTestHarness';

export function registerBitBoxConnectionTests(): void {
  describe('connection and device discovery', () => {
    it('checks WebHID support from browser capabilities and secure context', () => {
      const adapter = createBitBoxAdapter();
      expect(adapter.isSupported()).toBe(true);

      setWebHidEnv({ secure: false, withHid: true });
      expect(adapter.isSupported()).toBe(false);

      setWebHidEnv({ secure: true, withHid: false });
      expect(adapter.isSupported()).toBe(false);
    });

    it('returns empty authorized devices when unsupported', async () => {
      setWebHidEnv({ secure: false, withHid: true });
      await expect(createBitBoxAdapter().getAuthorizedDevices()).resolves.toEqual([]);
    });

    it('filters and maps authorized BitBox02 HID devices', async () => {
      setAuthorizedHidDevices([
        makeHidDevice({ opened: true, productName: 'BitBox02 BTC' }),
        makeHidDevice({ vendorId: 0x9999, productId: 0x8888 }),
      ]);

      const devices = await createBitBoxAdapter().getAuthorizedDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        id: 'bitbox-1003-9219',
        name: 'BitBox02 BTC',
        connected: true,
        model: 'BitBox02',
      });
    });

    it('uses fallback name and connected=false mapping when HID fields are missing', async () => {
      setAuthorizedHidDevices([makeHidDevice({ productName: undefined, opened: undefined })]);

      const devices = await createBitBoxAdapter().getAuthorizedDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        name: 'BitBox02',
        connected: false,
      });
    });

    it('handles HID enumeration errors', async () => {
      (globalThis.navigator as any).hid.getDevices.mockRejectedValue(new Error('hid failed'));
      await expect(createBitBoxAdapter().getAuthorizedDevices()).resolves.toEqual([]);
    });

    it('throws friendly errors for unsupported and common connect failures', async () => {
      setWebHidEnv({ secure: false, withHid: true });
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('WebHID is not supported');

      setWebHidEnv({ secure: true, withHid: true });
      mockGetDevicePath.mockRejectedValueOnce(new Error('NotAllowed'));
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('Access denied');

      mockGetDevicePath.mockRejectedValueOnce(new Error('Pairing rejected'));
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('Pairing was rejected');

      mockGetDevicePath.mockRejectedValueOnce(new Error('Firmware upgrade required'));
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('Firmware upgrade required');

      mockGetDevicePath.mockRejectedValueOnce(new Error('device busy'));
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('BitBox02 is busy');

      mockGetDevicePath.mockRejectedValueOnce(new Error('strange connect error'));
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('Failed to connect: strange connect error');

      mockGetDevicePath.mockRejectedValueOnce({ code: 'unknown' });
      await expect(createBitBoxAdapter().connect()).rejects.toThrow('Failed to connect: Unknown error');
    });

    it('connects successfully, sets device state, and handles close callback', async () => {
      let onCloseHandler!: () => void;

      mockApiConnect.mockImplementationOnce(async (pairing, userVerify, attestation, onClose, statusCb) => {
        pairing('1234-5678');
        await userVerify();
        attestation(false);
        statusCb('connected');
        onCloseHandler = onClose;
      });

      const adapter = createBitBoxAdapter();
      const device = await adapter.connect();

      expect(device.name).toBe('BitBox02 Multi');
      expect(device.connected).toBe(true);
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.getDevice()?.id).toBe('bitbox-1003-9219');
      expect(MockBitBox02API).toHaveBeenCalledWith('WEBHID');

      onCloseHandler();
      expect(adapter.getDevice()?.connected).toBe(false);
    });

    it('supports bitcoin-only product and handles early close/attestation-success branches', async () => {
      mockFirmwareProduct.mockReturnValue(constants.Product.BitBox02BTCOnly);
      mockApiConnect.mockImplementationOnce(async (_pairing, _userVerify, attestation, onClose) => {
        attestation(true);
        onClose();
      });

      const adapter = createBitBoxAdapter();
      const device = await adapter.connect();

      expect(device.name).toBe('BitBox02 Bitcoin-only');
      expect(adapter.isConnected()).toBe(true);
    });

    it('covers pairing timeout branch when resolve was already cleared', async () => {
      vi.useFakeTimers();
      try {
        const adapter = createBitBoxAdapter();
        mockApiConnect.mockImplementationOnce(async (_pairing, userVerify) => {
          const verifyPromise = userVerify();
          const resolve = (adapter as any).pairingResolve as (() => void) | null;
          resolve?.();
          (adapter as any).pairingResolve = null;
          await verifyPromise;
        });

        const connectPromise = adapter.connect();
        await vi.runAllTimersAsync();
        await expect(connectPromise).resolves.toMatchObject({
          type: 'bitbox',
          connected: true,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('closes previous connection before reconnect and ignores close errors', async () => {
      const adapter = createBitBoxAdapter();
      const close = vi.fn(() => {
        throw new Error('close fail');
      });
      (adapter as any).connection = { api: { close } };

      await adapter.connect();
      expect(close).toHaveBeenCalled();
      expect(adapter.isConnected()).toBe(true);
    });

    it('disconnects and clears internal state even when close throws', async () => {
      const adapter = createBitBoxAdapter();
      (adapter as any).connection = {
        api: { close: () => { throw new Error('close failed'); } },
      };
      (adapter as any).connectedDevice = {
        id: 'bitbox-1',
        type: 'bitbox',
        name: 'BitBox',
        model: 'BitBox02',
        connected: true,
        fingerprint: undefined,
      };
      (adapter as any).pairingCode = '1234';
      (adapter as any).pairingResolve = vi.fn();

      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(adapter.getDevice()).toBeNull();
      expect((adapter as any).pairingResolve).toBeNull();
    });

    it('disconnects cleanly when no connection exists', async () => {
      const adapter = createBitBoxAdapter();
      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(adapter.getDevice()).toBeNull();
    });

    it('requires connected state for xpub/address/sign operations', async () => {
      const adapter = createBitBoxAdapter();
      await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
      await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('No device connected');
      await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow('No device connected');
    });
  });
}

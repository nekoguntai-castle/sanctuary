import { describe, expect, it } from 'vitest';

import {
  createBitBoxAdapter,
  makeHidDevice,
  mockApiConnect,
  mockBtcXPub,
  mockDisplayAddressSimple,
  mockIsErrorAbort,
  seedConnectedAdapter,
  setAuthorizedHidDevices,
} from './bitboxAdapterTestHarness';

export function registerBitBoxXpubAddressTests(): void {
  describe('xpub and address verification', () => {
    it('returns xpub and maps abort errors for xpub/verify', async () => {
      const adapter = createBitBoxAdapter();
      seedConnectedAdapter(adapter);

      const result = await adapter.getXpub("m/84'/0'/0'");
      expect(result).toEqual({
        xpub: 'xpub-bitbox',
        fingerprint: '',
        path: "m/84'/0'/0'",
      });
      expect(mockBtcXPub).toHaveBeenCalledWith(31, expect.any(Array), 21, false);

      mockBtcXPub.mockResolvedValueOnce('upub-bitbox');
      await adapter.getXpub("m/49'/1'/0'");
      expect(mockBtcXPub).toHaveBeenLastCalledWith(30, expect.any(Array), 22, false);

      mockBtcXPub.mockResolvedValueOnce('xpub-taproot');
      await adapter.getXpub("m/86'/0'/0'");
      expect(mockBtcXPub).toHaveBeenLastCalledWith(31, expect.any(Array), 25, false);

      mockBtcXPub.mockResolvedValueOnce('tpub-default');
      await adapter.getXpub("m/44'/1'/0'");
      expect(mockBtcXPub).toHaveBeenLastCalledWith(30, expect.any(Array), 24, false);

      const abortErr = new Error('aborted');
      mockBtcXPub.mockRejectedValueOnce(abortErr);
      mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
      await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request cancelled on device');

      mockBtcXPub.mockRejectedValueOnce(new Error('xpub failed'));
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: xpub failed');

      mockBtcXPub.mockRejectedValueOnce('xpub failed');
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: Unknown error');

      await expect(adapter.verifyAddress("m/49h/0h/0h/0/0", '3abc')).resolves.toBe(true);
      expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 11, true);

      await expect(adapter.verifyAddress("m/86h/0h/0h/0/0", 'bc1pabc')).resolves.toBe(true);
      expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 12, true);

      await expect(adapter.verifyAddress("m/44'/0'/0'/0/0", '1abc')).resolves.toBe(true);
      expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 10, true);

      mockDisplayAddressSimple.mockRejectedValueOnce(abortErr);
      mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
      await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).resolves.toBe(false);

      mockDisplayAddressSimple.mockRejectedValueOnce(new Error('unexpected'));
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('Failed to verify address');

      mockDisplayAddressSimple.mockRejectedValueOnce('unexpected');
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow(
        'Failed to verify address: Unknown error'
      );
    });

    it('treats errors as non-abort when isErrorAbort itself throws', async () => {
      const adapter = createBitBoxAdapter();
      setAuthorizedHidDevices([makeHidDevice()]);
      mockApiConnect.mockResolvedValue(undefined);
      await adapter.connect();

      const deviceErr = new Error('device broke');
      mockBtcXPub.mockRejectedValueOnce(deviceErr);
      mockIsErrorAbort.mockImplementationOnce(() => {
        throw new Error('module load failed');
      });
      await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: device broke');
    });
  });
}

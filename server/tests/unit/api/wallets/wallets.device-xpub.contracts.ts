import { describe, expect, it, vi } from 'vitest';
import { mockAddDeviceToWallet, mockGenerateAddress, mockRepairWalletDescriptor, request, walletRouter } from './walletsTestHarness';

export const registerWalletDeviceXpubContracts = () => {
  // ==================== Device Management Tests ====================

  describe('POST /wallets/:id/addresses', () => {
    it('should generate new address', async () => {
      mockGenerateAddress.mockResolvedValue('bc1qnewaddress123');

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(201);
      expect(response.body.address).toBe('bc1qnewaddress123');
    });

    it('should handle address generation error', async () => {
      mockGenerateAddress.mockRejectedValue(new Error('Address generation failed'));

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /wallets/:id/devices', () => {
    it('should add device to wallet', async () => {
      mockAddDeviceToWallet.mockResolvedValue({ success: true });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({ deviceId: 'device-1', signerIndex: 0 });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('added');
    });

    it('should reject without deviceId', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('deviceId');
    });

    it('should handle add device errors', async () => {
      mockAddDeviceToWallet.mockRejectedValue(new Error('Add device failed'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({ deviceId: 'device-1', signerIndex: 0 });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /wallets/:id/repair', () => {
    it('should repair wallet descriptor', async () => {
      mockRepairWalletDescriptor.mockResolvedValue({
        success: true,
        message: 'Generated descriptor and 40 addresses',
      });

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/repair');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle repair error', async () => {
      mockRepairWalletDescriptor.mockRejectedValue(new Error('Repair failed'));

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/repair');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ==================== XPUB Validation Tests ====================

  describe('POST /wallets/validate-xpub', () => {
    it('should validate xpub and generate descriptor', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({ xpub: 'xpub6CUG...', scriptType: 'native_segwit' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.descriptor).toBeDefined();
      expect(response.body.firstAddress).toBeDefined();
    });

    it('should reject without xpub', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('xpub');
    });

    it('should reject invalid xpub', async () => {
      const addressDerivation = await import('../../../../src/services/bitcoin/addressDerivation');
      vi.mocked(addressDerivation.validateXpub).mockReturnValueOnce({ valid: false, error: 'Invalid xpub format' });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({ xpub: 'invalid-xpub' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid xpub');
    });
  });
};

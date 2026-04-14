import { describe, expect, it, vi } from 'vitest';
import { mockCreateWallet, mockDeleteWallet, mockGetUserWallets, mockGetWalletById, mockUpdateWallet, request, walletRouter } from './walletsTestHarness';

export const registerWalletCrudContracts = () => {
  // ==================== CRUD Tests ====================

  describe('GET /wallets', () => {
    it('should return all wallets for authenticated user', async () => {
      const mockWallets = [
        { id: 'wallet-1', name: 'Main Wallet', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet', balance: 100000 },
        { id: 'wallet-2', name: 'Savings', type: 'multi_sig', scriptType: 'native_segwit', network: 'mainnet', balance: 500000 },
      ];

      mockGetUserWallets.mockResolvedValue(mockWallets);

      const response = await request(walletRouter).get('/api/v1/wallets');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Main Wallet');
      expect(mockGetUserWallets).toHaveBeenCalledWith('test-user-id');
    });

    it('should return empty array when user has no wallets', async () => {
      mockGetUserWallets.mockResolvedValue([]);

      const response = await request(walletRouter).get('/api/v1/wallets');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle service errors gracefully', async () => {
      mockGetUserWallets.mockRejectedValue(new Error('Database error'));

      const response = await request(walletRouter).get('/api/v1/wallets');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /wallets', () => {
    it('should create a single-sig wallet', async () => {
      const walletData = {
        name: 'New Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
      };

      mockCreateWallet.mockResolvedValue({ id: 'wallet-new', ...walletData, createdAt: new Date() });

      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send(walletData);

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('New Wallet');
      expect(mockCreateWallet).toHaveBeenCalled();
    });

    it('should create a multi-sig wallet', async () => {
      const walletData = {
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
      };

      mockCreateWallet.mockResolvedValue({ id: 'wallet-multisig', ...walletData, createdAt: new Date() });

      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send(walletData);

      expect(response.status).toBe(201);
      expect(response.body.quorum).toBe(2);
      expect(response.body.totalSigners).toBe(3);
    });

    it('should reject wallet without required fields', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send({ name: 'Incomplete Wallet' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid wallet type', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'invalid_type', scriptType: 'native_segwit' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('single_sig or multi_sig');
    });

    it('should reject invalid script type', async () => {
      const { isValidScriptType } = await import('../../../../src/services/scriptTypes');
      vi.mocked(isValidScriptType).mockReturnValueOnce(false);

      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'single_sig', scriptType: 'invalid_script' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid scriptType');
    });

    it('should handle service creation error', async () => {
      mockCreateWallet.mockRejectedValue(new Error('Invalid descriptor format'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'single_sig', scriptType: 'native_segwit' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /wallets/:id', () => {
    it('should return wallet details', async () => {
      const mockWallet = {
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        balance: 150000,
      };

      mockGetWalletById.mockResolvedValue(mockWallet);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('wallet-123');
      expect(response.body.name).toBe('Test Wallet');
    });

    it('should return 404 for non-existent wallet', async () => {
      mockGetWalletById.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle service errors', async () => {
      mockGetWalletById.mockRejectedValue(new Error('Database error'));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /wallets/:id', () => {
    it('should update wallet name', async () => {
      mockUpdateWallet.mockResolvedValue({
        id: 'wallet-123',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      });

      const response = await request(walletRouter)
        .patch('/api/v1/wallets/wallet-123')
        .send({ name: 'Renamed Wallet' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Renamed Wallet');
    });

    it('should handle update error', async () => {
      mockUpdateWallet.mockRejectedValue(new Error('Update failed'));

      const response = await request(walletRouter)
        .patch('/api/v1/wallets/wallet-123')
        .send({ name: 'New Name' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /wallets/:id', () => {
    it('should delete wallet', async () => {
      mockDeleteWallet.mockResolvedValue({ success: true });

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(204);
      expect(mockDeleteWallet).toHaveBeenCalled();
    });

    it('should handle delete error', async () => {
      mockDeleteWallet.mockRejectedValue(new Error('Cannot delete'));

      const response = await request(walletRouter).delete('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
};

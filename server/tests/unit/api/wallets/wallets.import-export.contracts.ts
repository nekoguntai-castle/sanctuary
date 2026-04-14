import { describe, expect, it, vi } from 'vitest';
import { mockAddressRepository, mockImportWallet, mockTransactionRepository, mockValidateImport, mockWalletRepository, request, walletRouter } from './walletsTestHarness';

export const registerWalletImportExportContracts = () => {
  // ==================== Import Tests ====================

  describe('GET /wallets/import/formats', () => {
    it('should return available import formats', async () => {
      const response = await request(walletRouter).get('/api/v1/wallets/import/formats');

      expect(response.status).toBe(200);
      expect(response.body.formats).toBeDefined();
      expect(response.body.formats.length).toBeGreaterThan(0);
    });
  });

  describe('POST /wallets/import/validate', () => {
    it('should validate import descriptor', async () => {
      mockValidateImport.mockResolvedValue({
        valid: true,
        walletType: 'single_sig',
        scriptType: 'native_segwit',
        deviceCount: 1,
      });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/import/validate')
        .send({ descriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub.../0/*)' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });

    it('should validate import JSON', async () => {
      mockValidateImport.mockResolvedValue({
        valid: true,
        walletType: 'multi_sig',
        quorum: 2,
        totalSigners: 3,
      });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/import/validate')
        .send({ json: '{"name": "test", "descriptor": "wsh(...)"}' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });

    it('should reject when neither descriptor nor json provided', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/import/validate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('descriptor or json');
    });
  });

  describe('POST /wallets/import', () => {
    it('should import wallet from data', async () => {
      mockImportWallet.mockResolvedValue({
        wallet: { id: 'wallet-new', name: 'Imported Wallet' },
        devicesCreated: 1,
      });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh([aabbccdd/84h/0h/0h]xpub...)', name: 'Imported Wallet' });

      expect(response.status).toBe(201);
      expect(response.body.wallet).toBeDefined();
    });

    it('should reject without data', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/import')
        .send({ name: 'Wallet' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('data');
    });

    it('should reject without name', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh(...)' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('name');
    });

    it('should handle import error', async () => {
      mockImportWallet.mockRejectedValue(new Error('Import failed'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh(...)', name: 'Wallet' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ==================== Export Tests ====================

  describe('GET /wallets/:id/export/labels', () => {
    it('should export labels in BIP 329 format', async () => {
      mockWalletRepository.getName.mockResolvedValue('Test Wallet');
      mockTransactionRepository.findWithLabels.mockResolvedValue([
        { txid: 'txabc123', label: 'Payment', memo: 'Coffee shop', transactionLabels: [] },
      ]);
      mockAddressRepository.findWithLabels.mockResolvedValue([
        { address: 'bc1qtest', derivationPath: "m/84'/0'/0'/0/0", addressLabels: [{ label: { name: 'Deposit' } }] },
      ]);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export/labels');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('jsonl');
      expect(response.text).toContain('txabc123');
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.getName.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent/export/labels');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /wallets/:id/export/formats', () => {
    it('should return available export formats', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [],
        createdAt: new Date(),
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export/formats');

      expect(response.status).toBe(200);
      expect(response.body.formats).toBeDefined();
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent/export/formats');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /wallets/:id/export', () => {
    it('should export wallet in default format', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wpkh(...)',
        devices: [],
        createdAt: new Date(),
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('json');
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent/export');

      expect(response.status).toBe(404);
    });

    it('should reject unknown format', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [],
        createdAt: new Date(),
      });

      const { exportFormatRegistry } = await import('../../../../src/services/export');
      vi.mocked(exportFormatRegistry.has).mockReturnValueOnce(false);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export?format=unknown');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Unknown export format');
    });
  });
};

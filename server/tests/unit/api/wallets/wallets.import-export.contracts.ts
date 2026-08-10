import { describe, expect, it, vi } from 'vitest';
import {
  mockAddressRepository,
  mockExportFormatRegistry,
  mockImportWallet,
  mockTransactionRepository,
  mockValidateImport,
  mockWalletRepository,
  request,
  walletRouter,
} from './walletsTestHarness';

const signerLink = (overrides: Record<string, unknown> = {}) => ({
  id: 'wallet-device-1',
  walletId: 'wallet-123',
  deviceId: 'device-1',
  deviceAccountId: 'account-7',
  signerIndex: 0,
  signerBindingVersion: 1,
  signerFingerprint: 'snapshot-fingerprint',
  signerXpub: 'xpub-account-7',
  signerDerivationPath: "m/84'/0'/7'",
  signerPurpose: 'single_sig',
  signerScriptType: 'native_segwit',
  device: {
    id: 'device-1',
    label: 'Coldcard',
    type: 'coldcard',
    fingerprint: 'mutable-device-fingerprint',
    xpub: 'mutable-device-xpub',
    derivationPath: "m/84'/0'/0'",
    accounts: [{
      id: 'account-0',
      xpub: 'mutable-account-xpub',
      derivationPath: "m/84'/0'/0'",
      purpose: 'single_sig',
      scriptType: 'native_segwit',
    }],
    model: null,
  },
  ...overrides,
});

const exportWallet = (overrides: Record<string, unknown> = {}) => ({
  id: 'wallet-123',
  name: 'Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh(...)',
  quorum: null,
  totalSigners: null,
  devices: [signerLink()],
  createdAt: new Date(),
  ...overrides,
});

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
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
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
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet());

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
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet());

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('json');
      expect(mockExportFormatRegistry.export).toHaveBeenCalledWith(
        'sparrow',
        expect.objectContaining({
          devices: [expect.objectContaining({
            fingerprint: 'snapshot-fingerprint',
            xpub: 'xpub-account-7',
            derivationPath: "m/84'/0'/7'",
          })],
        }),
        expect.any(Object),
      );
    });

    it('should preserve multisig snapshot order and exact nonzero-account signer data', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet({
        type: 'multi_sig',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        devices: [
          signerLink({
            signerPurpose: 'multisig',
            signerXpub: 'xpub-signer-0-account-7',
            signerDerivationPath: "m/48'/0'/7'/2'",
          }),
          signerLink({
            id: 'wallet-device-2',
            deviceId: 'device-2',
            deviceAccountId: 'account-11',
            signerIndex: 1,
            signerPurpose: 'multisig',
            signerFingerprint: 'signer-1-fingerprint',
            signerXpub: 'xpub-signer-1-account-11',
            signerDerivationPath: "m/48'/0'/11'/2'",
          }),
        ],
      }));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(200);
      expect(mockExportFormatRegistry.export).toHaveBeenCalledWith(
        'sparrow',
        expect.objectContaining({
          devices: [
            expect.objectContaining({
              xpub: 'xpub-signer-0-account-7',
              derivationPath: "m/48'/0'/7'/2'",
            }),
            expect.objectContaining({
              fingerprint: 'signer-1-fingerprint',
              xpub: 'xpub-signer-1-account-11',
              derivationPath: "m/48'/0'/11'/2'",
            }),
          ],
        }),
        expect.any(Object),
      );
    });

    it('should export a complete immutable snapshot with an optional account link', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet({
        descriptor: null,
        devices: [signerLink({ deviceAccountId: null })],
      }));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(200);
      expect(mockExportFormatRegistry.export).toHaveBeenCalledWith(
        'sparrow',
        expect.objectContaining({
          devices: [expect.objectContaining({
            fingerprint: 'snapshot-fingerprint',
            derivationPath: "m/84'/0'/7'",
          })],
        }),
        expect.objectContaining({ includeDevices: true }),
      );
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(null);

      const response = await request(walletRouter).get('/api/v1/wallets/non-existent/export');

      expect(response.status).toBe(404);
    });

    it('should reject unknown format', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet({ name: 'Test' }));

      const { exportFormatRegistry } = await import('../../../../src/services/export');
      vi.mocked(exportFormatRegistry.has).mockReturnValueOnce(false);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export?format=unknown');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Unknown export format');
    });

    it.each([
      ['legacy-null', signerLink({
        deviceAccountId: null,
        signerIndex: null,
        signerBindingVersion: null,
        signerFingerprint: null,
        signerXpub: null,
        signerDerivationPath: null,
        signerPurpose: null,
        signerScriptType: null,
      })],
      ['incomplete', signerLink({ signerXpub: null })],
    ])('should fail closed for %s signer links', async (_caseName, link) => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet({ devices: [link] }));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(400);
      expect(mockExportFormatRegistry.export).not.toHaveBeenCalled();
    });

    it.each([
      ['duplicate signer devices', [
        signerLink(),
        signerLink({ id: 'wallet-device-2', deviceAccountId: 'account-8', signerIndex: 1 }),
      ]],
      ['duplicate signer accounts', [
        signerLink(),
        signerLink({ id: 'wallet-device-2', deviceId: 'device-2', signerIndex: 1 }),
      ]],
      ['duplicate signer indexes', [
        signerLink(),
        signerLink({ id: 'wallet-device-2', deviceId: 'device-2', deviceAccountId: 'account-8' }),
      ]],
      ['noncontiguous signer indexes', [
        signerLink(),
        signerLink({ id: 'wallet-device-2', deviceId: 'device-2', deviceAccountId: 'account-8', signerIndex: 2 }),
      ]],
    ])('should fail closed for %s', async (_caseName, devices) => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(exportWallet({
        type: 'multi_sig',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        devices: devices.map((link) => ({
          ...link,
          signerPurpose: 'multisig',
          signerDerivationPath: "m/48'/0'/7'/2'",
        })),
      }));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(400);
      expect(mockExportFormatRegistry.export).not.toHaveBeenCalled();
    });

    it.each([
      ['incomplete multisig signer set', exportWallet({
        type: 'multi_sig',
        quorum: 2,
        totalSigners: 2,
        devices: [signerLink({ signerPurpose: 'multisig' })],
      })],
      ['unsupported signer snapshot version', exportWallet({
        devices: [signerLink({ signerBindingVersion: 2 })],
      })],
      ['signer purpose policy mismatch', exportWallet({
        devices: [signerLink({ signerPurpose: 'multisig' })],
      })],
      ['signer derivation path network mismatch', exportWallet({
        devices: [signerLink({ signerDerivationPath: "m/84'/1'/7'" })],
      })],
      ['signer account index above the BIP32 maximum', exportWallet({
        devices: [signerLink({ signerDerivationPath: "m/84'/0'/2147483648'" })],
      })],
    ])('should reject %s', async (_caseName, wallet) => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(wallet);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(400);
      expect(mockExportFormatRegistry.export).not.toHaveBeenCalled();
    });
  });
};

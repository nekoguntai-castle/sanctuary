import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockWalletGetName,
  mockWalletFindByIdWithDevices,
  mockTxFindWithLabels,
  mockAddressFindWithLabels,
  mockGetAvailableFormats,
  mockHasFormat,
  mockExportFormat,
  mockAssertUnusedAddressesSafeForDisplay,
  mockAssertCanonicalAddressesForWallet,
} = vi.hoisted(() => ({
  mockWalletGetName: vi.fn(),
  mockWalletFindByIdWithDevices: vi.fn(),
  mockTxFindWithLabels: vi.fn(),
  mockAddressFindWithLabels: vi.fn(),
  mockGetAvailableFormats: vi.fn(),
  mockHasFormat: vi.fn(),
  mockExportFormat: vi.fn(),
  mockAssertUnusedAddressesSafeForDisplay: vi.fn(),
  mockAssertCanonicalAddressesForWallet: vi.fn(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: {
    getName: mockWalletGetName,
    findByIdWithDevices: mockWalletFindByIdWithDevices,
  },
  transactionRepository: {
    findWithLabels: mockTxFindWithLabels,
  },
  addressRepository: {
    findWithLabels: mockAddressFindWithLabels,
  },
}));

vi.mock('../../../src/services/export', () => ({
  exportFormatRegistry: {
    getAvailableFormats: mockGetAvailableFormats,
    has: mockHasFormat,
    export: mockExportFormat,
  },
}));

vi.mock('../../../src/services/addressDisplaySafety', () => ({
  assertUnusedAddressesSafeForDisplay: mockAssertUnusedAddressesSafeForDisplay,
}));

vi.mock('../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: mockAssertCanonicalAddressesForWallet,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { errorHandler } from '../../../src/errors/errorHandler';
import exportRouter from '../../../src/api/wallets/export';
import { mapDeviceTypeToSparrowWalletModel } from '../../../src/services/export/sparrowWalletModel';

function buildWallet(overrides: Record<string, any> = {}) {
  return {
    id: 'wallet-1',
    name: 'Main Wallet',
    type: 'multi_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    descriptor: 'wsh(sortedmulti(...))',
    quorum: 2,
    totalSigners: 3,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    devices: [
      {
        deviceId: 'device-a',
        deviceAccountId: 'account-a',
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: 'FPA',
        signerXpub: 'account-xpub-a',
        signerDerivationPath: "m/48'/0'/0'/2'",
        signerPurpose: 'multisig',
        signerScriptType: 'native_segwit',
        device: {
          label: 'Device Exact',
          type: 'coldcard',
          fingerprint: 'FPA',
          xpub: 'legacy-xpub-a',
          derivationPath: "m/48'/0'/0'/2'",
          accounts: [
            {
              purpose: 'multisig',
              scriptType: 'native_segwit',
              xpub: 'account-xpub-a',
              derivationPath: "m/48'/0'/0'/2'",
            },
          ],
        },
      },
      {
        deviceId: 'device-b',
        deviceAccountId: 'account-b',
        signerIndex: 1,
        signerBindingVersion: 1,
        signerFingerprint: 'FPB',
        signerXpub: 'account-xpub-b',
        signerDerivationPath: "m/48'/0'/1'/2'",
        signerPurpose: 'multisig',
        signerScriptType: 'native_segwit',
        device: {
          label: 'Device Purpose',
          type: 'bitbox',
          fingerprint: 'FPB',
          xpub: 'legacy-xpub-b',
          derivationPath: "m/48'/0'/1'/2'",
          model: { slug: 'bitbox02', name: 'BitBox02' },
          accounts: [
            {
              purpose: 'multisig',
              scriptType: 'taproot',
              xpub: 'account-xpub-b',
              derivationPath: "m/48'/0'/1'/2'",
            },
          ],
        },
      },
      {
        deviceId: 'device-c',
        deviceAccountId: 'account-c',
        signerIndex: 2,
        signerBindingVersion: 1,
        signerFingerprint: 'FPC',
        signerXpub: 'legacy-xpub-c',
        signerDerivationPath: "m/48'/0'/2'/2'",
        signerPurpose: 'multisig',
        signerScriptType: 'native_segwit',
        device: {
          label: 'Device Fallback',
          type: 'passport',
          fingerprint: 'FPC',
          xpub: 'legacy-xpub-c',
          derivationPath: "m/48'/0'/2'/2'",
          accounts: [],
        },
      },
    ],
    ...overrides,
  };
}

describe('Wallets Export Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/wallets', exportRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockWalletGetName.mockResolvedValue('My Wallet! 2025');
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet());
    mockAssertUnusedAddressesSafeForDisplay.mockResolvedValue(undefined);
    mockAssertCanonicalAddressesForWallet.mockResolvedValue(undefined);

    mockTxFindWithLabels.mockResolvedValue([
      {
        txid: 'tx-1',
        label: 'Salary',
        memo: 'Monthly',
        transactionLabels: [
          { label: { name: 'Income' } },
          { label: { name: 'Payroll' } },
        ],
      },
      {
        txid: 'tx-2',
        label: null,
        memo: null,
        transactionLabels: [],
      },
    ]);

    mockAddressFindWithLabels.mockResolvedValue([
      {
        id: 'addr-1',
        walletId: 'wallet-1',
        address: 'bc1qaddr1',
        derivationPath: "m/84'/0'/0'/0/1",
        index: 1,
        used: false,
        branch: 0,
        coordinateVersion: 1,
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
        scriptPubKey: '00140000000000000000000000000000000000000000',
        addressLabels: [
          { label: { name: 'Savings' } },
        ],
      },
      {
        id: 'addr-2',
        walletId: 'wallet-1',
        address: 'bc1qaddr2',
        derivationPath: null,
        index: 2,
        used: true,
        addressLabels: [],
      },
    ]);

    mockGetAvailableFormats.mockReturnValue([
      {
        id: 'sparrow',
        name: 'Sparrow',
        description: 'Sparrow Wallet format',
        fileExtension: 'json',
        mimeType: 'application/json',
      },
    ]);

    mockHasFormat.mockReturnValue(true);
    mockExportFormat.mockReturnValue({
      filename: 'main-wallet.json',
      mimeType: 'application/json',
      content: '{"wallet":"data"}',
    });
  });

  it.each(['ledger', 'jade', 'trezor', 'watch_only'])(
    'blocks %s descriptor, device-path, and address-label exports',
    async type => {
      mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
        devices: [{ device: { type, model: null, accounts: [] } }],
      }));

      for (const path of [
        '/api/v1/wallets/wallet-1/export/labels',
        '/api/v1/wallets/wallet-1/export/formats',
        '/api/v1/wallets/wallet-1/export',
      ]) {
        const response = await request(app).get(path);
        expect(response.status).toBe(403);
      }

      expect(mockAddressFindWithLabels).not.toHaveBeenCalled();
      expect(mockGetAvailableFormats).not.toHaveBeenCalled();
      expect(mockExportFormat).not.toHaveBeenCalled();
    },
  );

  it('exports labels in BIP329 format', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/jsonl');
    expect(response.headers['content-disposition']).toContain('My_Wallet__2025_labels_bip329.jsonl');

    const lines = response.text.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        type: 'tx',
        ref: 'tx-1',
        label: 'Salary, Monthly, Income, Payroll',
      },
      {
        type: 'addr',
        ref: 'bc1qaddr1',
        label: 'Savings',
        origin: "m/84'/0'/0'/0/1",
      },
    ]);
  });

  it('fails closed for unsafe unused or claimed-canonical label evidence', async () => {
    mockAssertUnusedAddressesSafeForDisplay.mockRejectedValueOnce(
      new Error('legacy unused address'),
    );
    const legacy = await request(app).get('/api/v1/wallets/wallet-1/export/labels');
    expect(legacy.status).toBe(500);

    mockAddressFindWithLabels.mockResolvedValueOnce([{
      id: 'addr-used-canonical',
      walletId: 'wallet-1',
      address: 'bc1qusedcanonical',
      derivationPath: "m/84'/0'/0'/0/2",
      index: 2,
      used: true,
      branch: 0,
      coordinateVersion: 1,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      scriptPubKey: '00140000000000000000000000000000000000000000',
      addressLabels: [{ label: { name: 'Used canonical' } }],
    }]);
    mockAssertCanonicalAddressesForWallet.mockRejectedValueOnce(
      new Error('canonical address drift'),
    );
    const drifted = await request(app).get('/api/v1/wallets/wallet-1/export/labels');
    expect(drifted.status).toBe(500);
    expect(drifted.text).not.toContain('bc1qusedcanonical');
  });

  it('does not re-derive an unused canonical label row twice', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');

    expect(response.status).toBe(200);
    expect(mockAssertUnusedAddressesSafeForDisplay).toHaveBeenCalledTimes(1);
    expect(mockAssertCanonicalAddressesForWallet).toHaveBeenCalledWith('wallet-1', []);
    expect(response.text).toContain("m/84'/0'/0'/0/1");
  });

  it('returns 404 when wallet does not exist for label export', async () => {
    mockWalletGetName.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
  });

  it('handles label export failures', async () => {
    mockTxFindWithLabels.mockRejectedValue(new Error('tx read failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('skips empty label names and omits origin when derivation path is missing', async () => {
    mockTxFindWithLabels.mockResolvedValue([
      {
        txid: 'tx-blank',
        label: null,
        memo: null,
        transactionLabels: [
          { label: { name: '' } },
          { label: { name: 'Tagged' } },
        ],
      },
    ]);

    mockAddressFindWithLabels.mockResolvedValue([
      {
        id: 'addr-blank',
        walletId: 'wallet-1',
        address: 'bc1qblank',
        derivationPath: null,
        index: 0,
        used: true,
        addressLabels: [
          { label: { name: '' } },
          { label: { name: 'AddressTag' } },
        ],
      },
    ]);

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');
    expect(response.status).toBe(200);

    const lines = response.text.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        type: 'tx',
        ref: 'tx-blank',
        label: 'Tagged',
      },
      {
        type: 'addr',
        ref: 'bc1qblank',
        label: 'AddressTag',
      },
    ]);
    expect(lines[1]).not.toHaveProperty('origin');
  });

  it('omits an unverified legacy path while retaining a verified change origin', async () => {
    const legacyAddress = {
      id: 'addr-legacy',
      walletId: 'wallet-1',
      address: 'bc1qlegacy',
      derivationPath: "m/84'/0'/0'/0/9",
      index: 9,
      used: true,
      branch: null,
      coordinateVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
      scriptPubKey: null,
      addressLabels: [{ label: { name: 'Legacy history' } }],
    };
    const canonicalChange = {
      id: 'addr-change',
      walletId: 'wallet-1',
      address: 'bc1qchange',
      derivationPath: "m/84'/0'/0'/1/4",
      index: 4,
      used: true,
      branch: 1,
      coordinateVersion: 1,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      scriptPubKey: '00140000000000000000000000000000000000000000',
      addressLabels: [{ label: { name: 'Verified change' } }],
    };
    mockAddressFindWithLabels.mockResolvedValueOnce([legacyAddress, canonicalChange]);

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/labels');
    expect(response.status).toBe(200);

    const lines = response.text.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toEqual(expect.arrayContaining([
      {
        type: 'addr',
        ref: legacyAddress.address,
        label: 'Legacy history',
      },
      {
        type: 'addr',
        ref: canonicalChange.address,
        label: 'Verified change',
        origin: canonicalChange.derivationPath,
      },
    ]));
    expect(lines.find(line => line.ref === legacyAddress.address)).not.toHaveProperty('origin');
    expect(mockAssertCanonicalAddressesForWallet).toHaveBeenCalledWith(
      'wallet-1',
      [canonicalChange],
    );
  });

  it('returns available export formats using immutable signer snapshot order', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');

    expect(response.status).toBe(200);
    expect(response.body.formats).toEqual([
      {
        id: 'sparrow',
        name: 'Sparrow',
        description: 'Sparrow Wallet format',
        extension: 'json',
        mimeType: 'application/json',
      },
    ]);

    expect(mockGetAvailableFormats).toHaveBeenCalledTimes(1);
    const walletDataArg = mockGetAvailableFormats.mock.calls[0][0];
    expect(walletDataArg.devices).toEqual([
      expect.objectContaining({ xpub: 'account-xpub-a', derivationPath: "m/48'/0'/0'/2'" }),
      expect.objectContaining({
        xpub: 'account-xpub-b',
        derivationPath: "m/48'/0'/1'/2'",
        modelSlug: 'bitbox02',
        modelName: 'BitBox02',
      }),
      expect.objectContaining({ xpub: 'legacy-xpub-c', derivationPath: "m/48'/0'/2'/2'" }),
    ]);
  });

  it('rejects single-sig export data without immutable signer snapshots', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
      type: 'single_sig',
      scriptType: 'taproot',
      devices: [
        {
          device: {
            label: 'No Accounts',
            type: 'bitbox',
            fingerprint: 'FP1',
            xpub: 'legacy-single-xpub',
            // accounts intentionally missing to cover [] fallback
          },
        },
        {
          device: {
            label: 'Purpose Match',
            type: 'bitbox',
            fingerprint: 'FP2',
            xpub: 'legacy-single-xpub-2',
            derivationPath: "m/86'/0'/0'",
            accounts: [
              {
                purpose: 'single_sig',
                scriptType: 'nested_segwit',
                xpub: 'purpose-only-xpub',
              },
            ],
          },
        },
      ],
    }));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');
    expect(response.status).toBe(400);
    expect(mockGetAvailableFormats).not.toHaveBeenCalled();
  });

  it('rejects signet export accounts without immutable signer snapshots', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'signet',
      devices: [
        {
          device: {
            label: 'Network Scoped',
            type: 'bitbox',
            fingerprint: 'FPS',
            xpub: 'legacy-xpub',
            derivationPath: "m/84'/0'/0'",
            accounts: [
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                xpub: 'xpub-mainnet',
                derivationPath: "m/84'/0'/0'",
              },
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                xpub: 'tpub-signet',
                derivationPath: "m/84'/1'/0'",
              },
            ],
          },
        },
      ],
    }));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');
    expect(response.status).toBe(400);
    expect(mockGetAvailableFormats).not.toHaveBeenCalled();
  });

  it('rejects unknown-coin account fallback when no signer snapshot exists', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet',
      devices: [
        {
          device: {
            label: 'Unknown Path',
            type: 'passport',
            fingerprint: 'FPU',
            xpub: 'legacy-xpub',
            derivationPath: "m/84'/0'/0'",
            accounts: [
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                xpub: 'unknown-path-xpub',
                derivationPath: 'custom-path',
              },
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                xpub: 'xpub-mainnet',
                derivationPath: "m/84'/0'/0'",
              },
            ],
          },
        },
      ],
    }));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');
    expect(response.status).toBe(400);
    expect(mockGetAvailableFormats).not.toHaveBeenCalled();
  });

  it('rejects an invalid multisig signer count', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
      descriptor: null,
      quorum: 0,
      totalSigners: 0,
    }));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');
    expect(response.status).toBe(400);
    expect(mockGetAvailableFormats).not.toHaveBeenCalled();
  });

  it('fails closed when exported wallet type is unsupported', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(buildWallet({
      type: 'unsupported_wallet_type',
    }));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');
    expect(response.status).toBe(400);
    expect(mockGetAvailableFormats).not.toHaveBeenCalled();
  });

  it('returns 404 when wallet is missing for export format listing', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
  });

  it('handles export format lookup failures', async () => {
    mockWalletFindByIdWithDevices.mockRejectedValue(new Error('lookup failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/export/formats');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('exports wallet in requested format', async () => {
    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'sparrow' });

    expect(response.status).toBe(200);
    expect(mockHasFormat).toHaveBeenCalledWith('sparrow');
    expect(mockExportFormat).toHaveBeenCalledWith(
      'sparrow',
      expect.objectContaining({ id: 'wallet-1' }),
      { includeDevices: true, includeChangeDescriptor: true }
    );
    expect(response.headers['content-disposition']).toContain('main-wallet.json');
    expect(response.text).toBe('{"wallet":"data"}');
  });

  it('defaults export format to sparrow when format query is missing', async () => {
    await request(app).get('/api/v1/wallets/wallet-1/export');

    expect(mockHasFormat).toHaveBeenCalledWith('sparrow');
  });

  it('returns 404 when wallet is missing for export', async () => {
    mockWalletFindByIdWithDevices.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'sparrow' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
  });

  it('returns 400 for unknown export format', async () => {
    mockHasFormat.mockReturnValue(false);

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'unknown' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Unknown export format: unknown');
  });

  it('returns 400 when export handler throws format-specific error', async () => {
    mockExportFormat.mockImplementation(() => {
      throw new Error('Format not supported for this wallet');
    });

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'sparrow' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns default export error message when thrown error has no message', async () => {
    mockExportFormat.mockImplementation(() => {
      throw { code: 'FORMAT_FAIL' };
    });

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'sparrow' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 when export flow fails unexpectedly', async () => {
    mockWalletFindByIdWithDevices.mockRejectedValue(new Error('db unavailable'));

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/export')
      .query({ format: 'sparrow' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('maps known and unknown hardware device types for Sparrow model names', () => {
    expect(mapDeviceTypeToSparrowWalletModel('coldcard')).toBe('COLDCARD');
    expect(mapDeviceTypeToSparrowWalletModel('ledger nano x')).toBe('LEDGER_NANO_X');
    expect(mapDeviceTypeToSparrowWalletModel('ledger nano s plus')).toBe('LEDGER_NANO_S_PLUS');
    expect(mapDeviceTypeToSparrowWalletModel('ledger_gen_5')).toBe('LEDGER_NANO_GEN5');
    expect(mapDeviceTypeToSparrowWalletModel('Ledger Gen 5')).toBe('LEDGER_NANO_GEN5');
    expect(mapDeviceTypeToSparrowWalletModel('trezor_safe_7')).toBe('TREZOR_SAFE_5');
    expect(mapDeviceTypeToSparrowWalletModel('generic_sd')).toBe('COLDCARD');
    expect(mapDeviceTypeToSparrowWalletModel('Unknown Device')).toBe('COLDCARD');
  });
});

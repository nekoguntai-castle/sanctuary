/**
 * Core API Module Tests
 *
 * Coverage-focused unit tests for src/api modules with low coverage:
 * - ai
 * - bitcoin
 * - devices
 * - wallets
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockDownload = vi.fn();
const mockSetToken = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    download: (...args: unknown[]) => mockDownload(...args),
    setToken: (...args: unknown[]) => mockSetToken(...args),
  },
}));

import * as aiApi from '../../src/api/ai';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as devicesApi from '../../src/api/devices';
import * as walletsApi from '../../src/api/wallets';

describe('Core API Modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AI API', () => {
    it('calls status and query endpoints', async () => {
      mockGet.mockResolvedValue({ available: true });
      mockPost.mockResolvedValue({ success: true });

      await aiApi.getAIStatus();
      await aiApi.suggestLabel({ transactionId: 'tx-1' });
      await aiApi.executeNaturalQuery({ query: 'recent tx', walletId: 'w1' });

      expect(mockGet).toHaveBeenCalledWith('/ai/status');
      expect(mockPost).toHaveBeenCalledWith('/ai/suggest-label', { transactionId: 'tx-1' });
      expect(mockPost).toHaveBeenCalledWith('/ai/query', { query: 'recent tx', walletId: 'w1' });
    });

    it('calls model and container management endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await aiApi.detectOllama();
      await aiApi.listModels();
      await aiApi.pullModel('llama3');
      await aiApi.deleteModel('llama3');
      await aiApi.getOllamaContainerStatus();
      await aiApi.startOllamaContainer();
      await aiApi.stopOllamaContainer();
      await aiApi.getSystemResources();

      expect(mockPost).toHaveBeenCalledWith('/ai/detect-ollama', {});
      expect(mockGet).toHaveBeenCalledWith('/ai/models');
      expect(mockPost).toHaveBeenCalledWith('/ai/pull-model', { model: 'llama3' });
      expect(mockDelete).toHaveBeenCalledWith('/ai/delete-model', { model: 'llama3' });
      expect(mockGet).toHaveBeenCalledWith('/ai/ollama-container/status');
      expect(mockPost).toHaveBeenCalledWith('/ai/ollama-container/start', {});
      expect(mockPost).toHaveBeenCalledWith('/ai/ollama-container/stop', {});
      expect(mockGet).toHaveBeenCalledWith('/ai/system-resources');
    });
  });

  describe('Bitcoin API', () => {
    it('calls status, fee, validation, and chain data endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await bitcoinApi.getStatus();
      await bitcoinApi.getFeeEstimates();
      await bitcoinApi.validateAddress({ address: 'bc1qabc' });
      await bitcoinApi.getAddressInfo('bc1qabc');
      await bitcoinApi.getAddressInfo('tb1qabc', 'testnet');
      await bitcoinApi.syncWallet('w1');
      await bitcoinApi.syncAddress('addr-1');
      await bitcoinApi.getTransactionDetails('txid-1');
      await bitcoinApi.broadcastTransaction({ rawTx: 'deadbeef' });
      await bitcoinApi.updateConfirmations('w1');
      await bitcoinApi.getBlockHeader(840000);
      await bitcoinApi.estimateFee({ inputCount: 1, outputCount: 2, feeRate: 10 });

      expect(mockGet).toHaveBeenCalledWith('/bitcoin/status');
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/fees');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/address/validate', { address: 'bc1qabc' });
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/address/bc1qabc', undefined);
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/address/tb1qabc', { network: 'testnet' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/wallet/w1/sync');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/address/addr-1/sync');
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/transaction/txid-1');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/broadcast', { rawTx: 'deadbeef' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/wallet/w1/update-confirmations');
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/block/840000');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/utils/estimate-fee', {
        inputCount: 1,
        outputCount: 2,
        feeRate: 10,
      });
    });

    it('calls advanced transaction and mempool endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await bitcoinApi.getAdvancedFeeEstimates();
      await bitcoinApi.checkRBF('txid-2');
      await bitcoinApi.createRBFTransaction('txid-2', { walletId: 'w1', newFeeRate: 20 });
      await bitcoinApi.createCPFPTransaction({
        walletId: 'w1',
        parentTxid: 'p1',
        parentVout: 0,
        targetFeeRate: 30,
        recipientAddress: 'bc1qdest',
      });
      await bitcoinApi.createBatchTransaction({
        walletId: 'w1',
        feeRate: 5,
        recipients: [{ address: 'bc1q1', amount: 1000 }],
      });
      await bitcoinApi.estimateOptimalFee({ inputCount: 1, outputCount: 2, priority: 'fast' });
      await bitcoinApi.getMempoolData();
      await bitcoinApi.lookupAddresses(['bc1q1', 'bc1q2']);

      expect(mockGet).toHaveBeenCalledWith('/bitcoin/fees/advanced');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/txid-2/rbf-check', {});
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/txid-2/rbf', {
        walletId: 'w1',
        newFeeRate: 20,
      });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/cpfp', {
        walletId: 'w1',
        parentTxid: 'p1',
        parentVout: 0,
        targetFeeRate: 30,
        recipientAddress: 'bc1qdest',
      });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/batch', {
        walletId: 'w1',
        feeRate: 5,
        recipients: [{ address: 'bc1q1', amount: 1000 }],
      });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/utils/estimate-optimal-fee', {
        inputCount: 1,
        outputCount: 2,
        priority: 'fast',
      });
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/mempool');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/address-lookup', { addresses: ['bc1q1', 'bc1q2'] });
    });
  });

  describe('Devices API', () => {
    it('calls CRUD and sharing endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockPatch.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await devicesApi.getDevices();
      await devicesApi.getDevice('d1');
      await devicesApi.createDevice({ type: 'ledger', label: 'Ledger', fingerprint: 'abcd1234' });
      await devicesApi.updateDevice('d1', { label: 'Ledger 2' });
      await devicesApi.deleteDevice('d1');
      await devicesApi.getDeviceModel('ledger-nano-x');
      await devicesApi.getManufacturers();
      await devicesApi.getDeviceShareInfo('d1');
      await devicesApi.shareDeviceWithUser('d1', { targetUserId: 'u2' });
      await devicesApi.removeUserFromDevice('d1', 'u2');
      await devicesApi.shareDeviceWithGroup('d1', { groupId: 'g1' });
      await devicesApi.addDeviceAccount('d1', {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub...',
      });

      expect(mockGet).toHaveBeenCalledWith('/devices');
      expect(mockGet).toHaveBeenCalledWith('/devices/d1');
      expect(mockPost).toHaveBeenCalledWith('/devices', {
        type: 'ledger',
        label: 'Ledger',
        fingerprint: 'abcd1234',
      });
      expect(mockPatch).toHaveBeenCalledWith('/devices/d1', { label: 'Ledger 2' });
      expect(mockDelete).toHaveBeenCalledWith('/devices/d1');
      expect(mockGet).toHaveBeenCalledWith('/devices/models/ledger-nano-x');
      expect(mockGet).toHaveBeenCalledWith('/devices/manufacturers');
      expect(mockGet).toHaveBeenCalledWith('/devices/d1/share');
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/share/user', { targetUserId: 'u2' });
      expect(mockDelete).toHaveBeenCalledWith('/devices/d1/share/user/u2');
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/share/group', { groupId: 'g1' });
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/accounts', {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub...',
      });
    });

    it('handles createDeviceWithConflictHandling branches', async () => {
      const createPayload = { type: 'ledger', label: 'Ledger', fingerprint: 'fp1' };

      mockPost.mockResolvedValueOnce({ id: 'd1', label: 'Ledger' });
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).resolves.toEqual({
        status: 'created',
        device: { id: 'd1', label: 'Ledger' },
      });

      mockPost.mockResolvedValueOnce({ message: 'Merged', added: 1, device: { id: 'd1' } });
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).resolves.toEqual({
        status: 'merged',
        result: { message: 'Merged', added: 1, device: { id: 'd1' } },
      });

      const conflictPayload = {
        existingDevice: { id: 'd1' },
        comparison: { matchingAccounts: [], newAccounts: [], conflictingAccounts: [] },
      };
      mockPost.mockRejectedValueOnce({ status: 409, response: conflictPayload });
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).resolves.toEqual({
        status: 'conflict',
        conflict: conflictPayload,
      });

      mockPost.mockRejectedValueOnce({ status: 409, data: conflictPayload });
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).resolves.toEqual({
        status: 'conflict',
        conflict: conflictPayload,
      });

      const conflictWithoutPayload = { status: 409, message: 'Conflict without payload' };
      mockPost.mockRejectedValueOnce(conflictWithoutPayload);
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).rejects.toEqual(conflictWithoutPayload);

      const otherError = new Error('boom');
      mockPost.mockRejectedValueOnce(otherError);
      await expect(devicesApi.createDeviceWithConflictHandling(createPayload)).rejects.toThrow('boom');
    });

    it('builds query params for device model filters and merge requests', async () => {
      mockGet.mockResolvedValue([]);
      mockPost.mockResolvedValue({ message: 'ok', added: 1, device: { id: 'd1' } });

      await devicesApi.getDeviceModels();
      await devicesApi.getDeviceModels({
        manufacturer: 'Ledger',
        airGapped: true,
        connectivity: 'usb',
        showDiscontinued: true,
      });
      await devicesApi.mergeDeviceAccounts({ type: 'ledger', label: 'L', fingerprint: 'fp2' });

      expect(mockGet).toHaveBeenCalledWith('/devices/models');
      expect(mockGet).toHaveBeenCalledWith('/devices/models?manufacturer=Ledger&airGapped=true&connectivity=usb&showDiscontinued=true');
      expect(mockPost).toHaveBeenCalledWith('/devices', {
        type: 'ledger',
        label: 'L',
        fingerprint: 'fp2',
        merge: true,
      });
    });
  });

  describe('Wallets API', () => {
    it('calls wallet CRUD, sharing, and export endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockPatch.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await walletsApi.getWallets();
      await walletsApi.getWallet('w1');
      await walletsApi.createWallet({ name: 'W1', type: 'single_sig', scriptType: 'native_segwit' });
      await walletsApi.updateWallet('w1', { name: 'W2' });
      await walletsApi.deleteWallet('w1');
      await walletsApi.repairWallet('w1');
      await walletsApi.getWalletStats('w1');
      await walletsApi.generateAddress('w1');
      await walletsApi.addDeviceToWallet('w1', { deviceId: 'd1' });
      await walletsApi.validateImport({ descriptor: 'wpkh(...)' });
      await walletsApi.importWallet({ data: 'wpkh(...)', name: 'Imported' });
      await walletsApi.shareWalletWithGroup('w1', { groupId: 'g1' });
      await walletsApi.shareWalletWithUser('w1', { targetUserId: 'u1' });
      await walletsApi.removeUserFromWallet('w1', 'u1');
      await walletsApi.getWalletShareInfo('w1');
      await walletsApi.getExportFormats('w1');
      await walletsApi.exportWallet('w1');

      expect(mockGet).toHaveBeenCalledWith('/wallets');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1');
      expect(mockPost).toHaveBeenCalledWith('/wallets', {
        name: 'W1',
        type: 'single_sig',
        scriptType: 'native_segwit',
      });
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1', { name: 'W2' });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/repair');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/stats');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/addresses');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/devices', { deviceId: 'd1' });
      expect(mockPost).toHaveBeenCalledWith('/wallets/import/validate', { descriptor: 'wpkh(...)' });
      expect(mockPost).toHaveBeenCalledWith('/wallets/import', { data: 'wpkh(...)', name: 'Imported' });
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/share/group', { groupId: 'g1' });
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/share/user', { targetUserId: 'u1' });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1/share/user/u1');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/share');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/export/formats');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/export');
    });

    it('calls export download helpers with sanitized filenames', async () => {
      mockDownload.mockResolvedValue(undefined);

      await walletsApi.exportWalletFormat('w1', 'sparrow', 'My Wallet@Name');
      await walletsApi.exportLabelsBip329('w1', 'My Wallet Name');

      expect(mockDownload).toHaveBeenCalledWith(
        '/wallets/w1/export',
        'My_Wallet_Name_export',
        { params: { format: 'sparrow' } }
      );
      expect(mockDownload).toHaveBeenCalledWith(
        '/wallets/w1/export/labels',
        'My_Wallet_Name_labels_bip329.jsonl'
      );
    });

    it('handles telegram settings endpoints and token extraction', async () => {
      const settings = {
        enabled: true,
        notifyReceived: true,
        notifySent: false,
        notifyConsolidation: false,
        notifyDraft: true,
      };
      mockGet.mockResolvedValue({ settings });
      mockPatch.mockResolvedValue({});

      const result = await walletsApi.getWalletTelegramSettings('w1');
      await walletsApi.updateWalletTelegramSettings('w1', { notifySent: true });

      expect(result).toEqual(settings);
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/telegram');
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1/telegram', { notifySent: true });
    });
  });
});

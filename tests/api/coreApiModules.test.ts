/**
 * Core API Module Tests
 *
 * Coverage-focused unit tests for src/api modules with low coverage:
 * - ai
 * - bitcoin
 * - devices
 * - wallets
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockDownload = vi.fn();
const MockApiError = vi.hoisted(
  () =>
    class ApiError extends Error {
      constructor(
        message: string,
        public status: number,
        public response?: Record<string, unknown>,
      ) {
        super(message);
        this.name = 'ApiError';
      }
    },
);

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    download: (...args: unknown[]) => mockDownload(...args),
  },
  ApiError: MockApiError,
}));

import * as aiApi from '../../src/api/ai';
import { ApiError } from '../../src/api/client';
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
      const queryController = new AbortController();

      await aiApi.getAIStatus();
      await aiApi.testAIConnection();
      await aiApi.suggestLabel({ transactionId: 'tx-1' });
      await aiApi.executeNaturalQuery(
        { query: 'recent tx', walletId: 'w1' },
        queryController.signal,
      );

      expect(mockGet).toHaveBeenCalledWith('/ai/status');
      expect(mockPost).toHaveBeenCalledWith('/ai/test-connection', {}, { timeoutMs: 20000 });
      expect(mockPost).toHaveBeenCalledWith('/ai/suggest-label', { transactionId: 'tx-1' });
      expect(mockPost).toHaveBeenCalledWith('/ai/query', { query: 'recent tx', walletId: 'w1' }, {
        timeoutMs: 120000,
        signal: queryController.signal,
      });
    });

    it('calls provider discovery and model listing endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await aiApi.detectOllama();
      await aiApi.detectProvider({
        endpoint: 'http://studio.local:1234',
        preferredProviderType: 'openai-compatible',
      });
      await aiApi.listModels();

      expect(mockPost).toHaveBeenCalledWith('/ai/detect-ollama', {});
      expect(mockPost).toHaveBeenCalledWith('/ai/detect-provider', {
        endpoint: 'http://studio.local:1234',
        preferredProviderType: 'openai-compatible',
      });
      expect(mockGet).toHaveBeenCalledWith('/ai/models');
    });

    it('returns blocked provider detection API errors as visible detection results', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiError(
          'AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints.',
          400,
          {
            message:
              'AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints.',
            blockedReason: 'host_not_allowed',
          },
        ),
      );

      await expect(
        aiApi.detectProvider({
          endpoint: 'http://10.114.123.214:1234',
          preferredProviderType: 'openai-compatible',
        }),
      ).resolves.toEqual({
        found: false,
        message:
          'AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints.',
        blockedReason: 'host_not_allowed',
      });
    });

    it('returns provider detection proxy failures without blocked reasons', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiError('Provider endpoint did not respond', 502, {}),
      );

      await expect(
        aiApi.detectProvider({
          endpoint: 'http://studio.local:1234',
          preferredProviderType: 'openai-compatible',
        }),
      ).resolves.toEqual({
        found: false,
        message: 'Provider endpoint did not respond',
        blockedReason: undefined,
      });
    });

    it('rethrows unexpected provider detection API statuses', async () => {
      const apiError = new ApiError('internal error', 500, {});
      mockPost.mockRejectedValueOnce(apiError);

      await expect(
        aiApi.detectProvider({
          endpoint: 'http://studio.local:1234',
          preferredProviderType: 'openai-compatible',
        }),
      ).rejects.toBe(apiError);
    });

    it('rethrows unexpected provider detection errors', async () => {
      const unexpectedError = new Error('socket closed');
      mockPost.mockRejectedValueOnce(unexpectedError);

      await expect(
        aiApi.detectProvider({
          endpoint: 'http://studio.local:1234',
          preferredProviderType: 'openai-compatible',
        }),
      ).rejects.toBe(unexpectedError);
    });
  });

  describe('Bitcoin API', () => {
    it('calls status, fee, validation, and chain data endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await bitcoinApi.getStatus();
      await bitcoinApi.getFeeEstimates();
      await bitcoinApi.getFeeEstimates('signet');
      await bitcoinApi.validateAddress({ address: 'bc1qabc' });
      await bitcoinApi.getAddressInfo('bc1qabc');
      await bitcoinApi.getAddressInfo('tb1qabc', 'testnet3');
      await bitcoinApi.syncWallet('w1');
      await bitcoinApi.syncAddress('addr-1');
      await bitcoinApi.getTransactionDetails('txid-1');
      await bitcoinApi.getTransactionDetails('txid-3', 'testnet4');
      await bitcoinApi.broadcastRawNetworkTransaction({ rawTx: 'deadbeef', network: 'signet' });
      await bitcoinApi.updateConfirmations('w1');
      await bitcoinApi.getBlockHeader(840000);
      await bitcoinApi.estimateFee({ inputCount: 1, outputCount: 2, feeRate: 10 });

      expect(mockGet).toHaveBeenCalledWith('/bitcoin/status', { network: 'mainnet' });
      // Fees now carry a response schema — the endpoint whose unchecked null
      // crashed the dashboard. `expect.objectContaining` rather than the schema
      // itself so this stays about the call, not zod's identity.
      expect(mockGet).toHaveBeenCalledWith(
        '/bitcoin/fees',
        undefined,
        undefined,
        expect.objectContaining({ schema: expect.anything() }),
      );
      expect(mockGet).toHaveBeenCalledWith(
        '/bitcoin/fees',
        { network: 'signet' },
        undefined,
        expect.objectContaining({ schema: expect.anything() }),
      );
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/address/validate', { address: 'bc1qabc' });
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/address/bc1qabc', undefined);
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/address/tb1qabc', { network: 'testnet3' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/wallet/w1/sync');
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/address/addr-1/sync');
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/transaction/txid-1', undefined);
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/transaction/txid-3', { network: 'testnet4' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/broadcast', { rawTx: 'deadbeef', network: 'signet' });
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
      await bitcoinApi.getAdvancedFeeEstimates('testnet4');
      await bitcoinApi.checkRBF('txid-2', 'w1');
      await bitcoinApi.checkRBF('txid-3', 'w2');
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
      await bitcoinApi.getMempoolData('signet');
      await bitcoinApi.lookupAddresses(['bc1q1', 'bc1q2']);

      expect(mockGet).toHaveBeenCalledWith('/bitcoin/fees/advanced', undefined);
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/fees/advanced', { network: 'testnet4' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/txid-2/rbf-check', { walletId: 'w1' });
      expect(mockPost).toHaveBeenCalledWith('/bitcoin/transaction/txid-3/rbf-check', { walletId: 'w2' });
      // RBF now validates its response — it feeds a persisted, signed draft.
      expect(mockPost).toHaveBeenCalledWith(
        '/bitcoin/transaction/txid-2/rbf',
        { walletId: 'w1', newFeeRate: 20 },
        expect.objectContaining({ schema: expect.anything() }),
      );
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
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/mempool', { network: 'mainnet' });
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/mempool', { network: 'signet' });
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
        masterFingerprint: 'abcd1234',
      });

      expect(mockGet).toHaveBeenCalledWith('/devices');
      expect(mockGet).toHaveBeenCalledWith('/devices/d1', undefined, undefined, {
        signal: undefined,
      });
      expect(mockPost).toHaveBeenCalledWith('/devices', {
        type: 'ledger',
        label: 'Ledger',
        fingerprint: 'abcd1234',
      });
      expect(mockPatch).toHaveBeenCalledWith('/devices/d1', { label: 'Ledger 2' });
      expect(mockDelete).toHaveBeenCalledWith('/devices/d1');
      expect(mockGet).toHaveBeenCalledWith('/devices/models/ledger-nano-x');
      expect(mockGet).toHaveBeenCalledWith('/devices/manufacturers');
      expect(mockGet).toHaveBeenCalledWith('/devices/d1/share', undefined, undefined, {
        signal: undefined,
      });
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/share/user', { targetUserId: 'u2' });
      expect(mockDelete).toHaveBeenCalledWith('/devices/d1/share/user/u2');
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/share/group', { groupId: 'g1' });
      expect(mockPost).toHaveBeenCalledWith('/devices/d1/accounts', {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub...',
        masterFingerprint: 'abcd1234',
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
      await devicesApi.getDeviceModels({
        manufacturer: '',
        airGapped: false,
        connectivity: '',
        showDiscontinued: false,
      });
      await devicesApi.mergeDeviceAccounts({ type: 'ledger', label: 'L', fingerprint: 'fp2' });

      expect(mockGet).toHaveBeenCalledWith('/devices/models', undefined, undefined, {
        signal: undefined,
      });
      expect(mockGet).toHaveBeenCalledWith('/devices/models', {
        manufacturer: 'Ledger',
        airGapped: true,
        connectivity: 'usb',
        showDiscontinued: true,
      }, undefined, { signal: undefined });
      expect(mockGet).toHaveBeenCalledWith('/devices/models', {
        manufacturer: undefined,
        airGapped: false,
        connectivity: undefined,
        showDiscontinued: undefined,
      }, undefined, { signal: undefined });
      expect(mockPost).toHaveBeenCalledWith('/devices', {
        type: 'ledger',
        label: 'L',
        fingerprint: 'fp2',
        merge: true,
      });
    });

    it('forwards cancellation signals for device detail reads', async () => {
      mockGet.mockResolvedValue({});
      const controller = new AbortController();

      await devicesApi.getDevice('d1', controller.signal);
      await devicesApi.getDeviceModels(undefined, controller.signal);
      await devicesApi.getDeviceShareInfo('d1', controller.signal);

      expect(mockGet).toHaveBeenCalledWith('/devices/d1', undefined, undefined, {
        signal: controller.signal,
      });
      expect(mockGet).toHaveBeenCalledWith('/devices/models', undefined, undefined, {
        signal: controller.signal,
      });
      expect(mockGet).toHaveBeenCalledWith('/devices/d1/share', undefined, undefined, {
        signal: controller.signal,
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
      await walletsApi.createWallet({
        name: 'W1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        signers: [{ deviceId: 'd1', deviceAccountId: 'a1', signerIndex: 0 }],
      });
      await walletsApi.updateWallet('w1', { name: 'W2' });
      await walletsApi.deleteWallet('w1');
      await walletsApi.repairWallet('w1');
      await walletsApi.getWalletStats('w1');
      await walletsApi.generateAddress('w1');
      await walletsApi.addDeviceToWallet('w1', { deviceId: 'd1' });
      await walletsApi.validateImport({ descriptor: 'wpkh(...)' });
      await walletsApi.validateXpub({
        xpub: 'tpub-inline',
        scriptType: 'native_segwit',
        network: 'testnet3',
        fingerprint: '00000000',
      });
      await walletsApi.importWallet({ data: 'wpkh(...)', name: 'Imported' });
      await walletsApi.shareWalletWithGroup('w1', { groupId: 'g1' });
      await walletsApi.shareWalletWithUser('w1', { targetUserId: 'u1' });
      await walletsApi.removeUserFromWallet('w1', 'u1');
      await walletsApi.getWalletShareInfo('w1');
      await walletsApi.getExportFormats('w1');
      await walletsApi.exportWallet('w1');

      expect(mockGet).toHaveBeenCalledWith(
        '/wallets',
        undefined,
        undefined,
        expect.objectContaining({ schema: expect.anything() }),
      );
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1');
      expect(mockPost).toHaveBeenCalledWith('/wallets', {
        name: 'W1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        signers: [{ deviceId: 'd1', deviceAccountId: 'a1', signerIndex: 0 }],
      });
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1', { name: 'W2' });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/repair');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/stats');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/addresses');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/devices', { deviceId: 'd1' });
      expect(mockPost).toHaveBeenCalledWith('/wallets/import/validate', { descriptor: 'wpkh(...)' });
      // Xpub validation now validates its response — it becomes key material.
      expect(mockPost).toHaveBeenCalledWith(
        '/wallets/validate-xpub',
        {
          xpub: 'tpub-inline',
          scriptType: 'native_segwit',
          network: 'testnet3',
          fingerprint: '00000000',
        },
        expect.objectContaining({ schema: expect.anything() }),
      );
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

    it('calls autopilot settings and status endpoints', async () => {
      mockGet.mockResolvedValue({ settings: { enabled: true, targetUtxoCount: 5 } });
      mockPatch.mockResolvedValue({});

      const settings = await walletsApi.getWalletAutopilotSettings('w1');
      await walletsApi.updateWalletAutopilotSettings('w1', { enabled: false });

      expect(settings).toEqual({ enabled: true, targetUtxoCount: 5 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/autopilot');
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1/autopilot', { enabled: false });

      mockGet.mockResolvedValue({ healthy: true, utxoCount: 10 });
      const status = await walletsApi.getWalletAutopilotStatus('w1');
      expect(status).toEqual({ healthy: true, utxoCount: 10 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/autopilot/status');
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

    it('handles wallet webhook endpoints and response unwrapping', async () => {
      const webhook = { id: 'webhook-1', walletId: 'w1', name: 'Accounting' };
      const delivery = { id: 'delivery-1', endpointId: 'webhook-1', walletId: 'w1' };
      const input = {
        name: 'Accounting',
        url: 'https://example.com/hook',
        eventTypes: ['wallet.transaction.received'],
      };

      mockGet
        .mockResolvedValueOnce({ webhooks: [webhook] })
        .mockResolvedValueOnce({ webhook })
        .mockResolvedValueOnce({ deliveries: [delivery] })
        .mockResolvedValueOnce({ deliveries: [] });
      mockPost
        .mockResolvedValueOnce({ webhook })
        .mockResolvedValueOnce({ success: true, message: 'Webhook endpoint URL is allowed' })
        .mockResolvedValueOnce({
          success: true,
          queued: true,
          message: 'Webhook delivery replay queued',
          delivery,
        });
      mockPatch.mockResolvedValueOnce({ webhook });
      mockDelete.mockResolvedValueOnce(undefined);

      await expect(walletsApi.listWalletWebhooks('w1')).resolves.toEqual([webhook]);
      await expect(walletsApi.getWalletWebhook('w1', 'webhook-1')).resolves.toEqual(webhook);
      await expect(walletsApi.createWalletWebhook('w1', input)).resolves.toEqual(webhook);
      await expect(walletsApi.updateWalletWebhook('w1', 'webhook-1', { enabled: false })).resolves.toEqual(webhook);
      await expect(walletsApi.deleteWalletWebhook('w1', 'webhook-1')).resolves.toBeUndefined();
      await expect(walletsApi.testWalletWebhook('w1', 'webhook-1')).resolves.toEqual({
        success: true,
        message: 'Webhook endpoint URL is allowed',
      });
      await expect(walletsApi.getWalletWebhookDeliveries('w1', 'webhook-1')).resolves.toEqual([delivery]);
      await expect(walletsApi.getWalletWebhookDeliveries('w1', 'webhook-1', 25)).resolves.toEqual([]);
      await expect(walletsApi.replayWalletWebhookDelivery('w1', 'webhook-1', 'delivery-1')).resolves.toEqual({
        success: true,
        queued: true,
        message: 'Webhook delivery replay queued',
        delivery,
      });

      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/webhooks');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/webhooks', input);
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1', { enabled: false });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1/test');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1/deliveries', { limit: 50 });
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1/deliveries', { limit: 25 });
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1/deliveries/delivery-1/replay');
    });

    it('rejects webhook response redaction markers before create or update requests', async () => {
      const createInput = {
        name: 'Accounting',
        url: 'https://example.com/hook',
        eventTypes: ['wallet.transaction.received'],
        headerConfig: { headers: { Authorization: '[REDACTED]' } },
      };

      await expect(walletsApi.createWalletWebhook('w1', createInput))
        .rejects.toThrow('Header Authorization must be replaced with its real value or removed');
      await expect(walletsApi.updateWalletWebhook('w1', 'webhook-1', {
        headerConfig: { headers: { 'X-API-Key': '[REDACTED]' } },
      })).rejects.toThrow('Header X-API-Key must be replaced with its real value or removed');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('allows explicit webhook header removals through the update client', async () => {
      const webhook = { id: 'webhook-1', walletId: 'w1' };
      const input = { headerConfig: { headers: { 'X-Old': null } } };
      mockPatch.mockResolvedValueOnce({ webhook });

      await expect(walletsApi.updateWalletWebhook('w1', 'webhook-1', input))
        .resolves.toEqual(webhook);
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1/webhooks/webhook-1', input);
    });
  });
});

/**
 * Remaining API Module Tests
 *
 * Coverage-focused unit tests for remaining low-coverage API modules:
 * - drafts, labels, node, payjoin, price, sync, transfers, twoFactor
 * - admin backup/settings/monitoring/groups/users
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';

// Phase 4: setToken/getToken were removed from the apiClient surface —
// browser auth lives in HttpOnly cookies. The mock no longer needs them.
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockFetch = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  API_BASE_URL: '/api/v1',
}));

import * as adminBackupApi from '../../src/api/admin/backup';
import * as adminFeaturesApi from '../../src/api/admin/features';
import * as adminGroupsApi from '../../src/api/admin/groups';
import * as adminMonitoringApi from '../../src/api/admin/monitoring';
import * as adminSettingsApi from '../../src/api/admin/settings';
import * as adminUsersApi from '../../src/api/admin/users';
import * as draftsApi from '../../src/api/drafts';
import * as labelsApi from '../../src/api/labels';
import * as payjoinApi from '../../src/api/payjoin';
import * as priceApi from '../../src/api/price';
import * as syncApi from '../../src/api/sync';
import * as transfersApi from '../../src/api/transfers';
import * as twoFactorApi from '../../src/api/twoFactor';

describe('Remaining API Modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('Drafts API', () => {
    it('calls draft CRUD endpoints', async () => {
      mockGet.mockResolvedValue([]);
      mockPost.mockResolvedValue({});
      mockPatch.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await draftsApi.getDrafts('w1');
      await draftsApi.getDraft('w1', 'd1');
      await draftsApi.createDraft('w1', {
        recipient: 'bc1qdest',
        amount: 1000,
        feeRate: 5,
        psbtBase64: 'psbt',
      });
      await draftsApi.updateDraft('w1', 'd1', { status: 'signed' });
      await draftsApi.deleteDraft('w1', 'd1');

      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/drafts');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/drafts/d1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/drafts', {
        recipient: 'bc1qdest',
        amount: 1000,
        feeRate: 5,
        psbtBase64: 'psbt',
      });
      expect(mockPatch).toHaveBeenCalledWith('/wallets/w1/drafts/d1', { status: 'signed' });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1/drafts/d1');
    });
  });

  describe('Labels API', () => {
    it('calls label and item-label endpoints', async () => {
      mockGet.mockResolvedValue([]);
      mockPost.mockResolvedValue([]);
      mockPut.mockResolvedValue([]);
      mockDelete.mockResolvedValue({});

      await labelsApi.getLabels('w1');
      await labelsApi.getLabel('w1', 'l1');
      await labelsApi.createLabel('w1', { name: 'Important' });
      await labelsApi.updateLabel('w1', 'l1', { color: '#ff0000' });
      await labelsApi.deleteLabel('w1', 'l1');
      await labelsApi.getTransactionLabels('tx1');
      await labelsApi.addTransactionLabels('tx1', ['l1', 'l2']);
      await labelsApi.setTransactionLabels('tx1', ['l2']);
      await labelsApi.removeTransactionLabel('tx1', 'l2');
      await labelsApi.getAddressLabels('addr1');
      await labelsApi.addAddressLabels('addr1', ['l1']);
      await labelsApi.setAddressLabels('addr1', ['l2']);
      await labelsApi.removeAddressLabel('addr1', 'l2');

      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/labels');
      expect(mockGet).toHaveBeenCalledWith('/wallets/w1/labels/l1');
      expect(mockPost).toHaveBeenCalledWith('/wallets/w1/labels', { name: 'Important' });
      expect(mockPut).toHaveBeenCalledWith('/wallets/w1/labels/l1', { color: '#ff0000' });
      expect(mockDelete).toHaveBeenCalledWith('/wallets/w1/labels/l1');
      expect(mockGet).toHaveBeenCalledWith('/transactions/tx1/labels');
      expect(mockPost).toHaveBeenCalledWith('/transactions/tx1/labels', { labelIds: ['l1', 'l2'] });
      expect(mockPut).toHaveBeenCalledWith('/transactions/tx1/labels', { labelIds: ['l2'] });
      expect(mockDelete).toHaveBeenCalledWith('/transactions/tx1/labels/l2');
      expect(mockGet).toHaveBeenCalledWith('/addresses/addr1/labels');
      expect(mockPost).toHaveBeenCalledWith('/addresses/addr1/labels', { labelIds: ['l1'] });
      expect(mockPut).toHaveBeenCalledWith('/addresses/addr1/labels', { labelIds: ['l2'] });
      expect(mockDelete).toHaveBeenCalledWith('/addresses/addr1/labels/l2');
    });
  });

  describe('Payjoin API', () => {
    it('builds params and calls payjoin endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await payjoinApi.getPayjoinUri('addr-id');
      await payjoinApi.getPayjoinUri('addr-id', { amount: 1000, label: 'Invoice', message: 'Order #1' });
      await payjoinApi.parsePayjoinUri('bitcoin:bc1q...');
      await payjoinApi.attemptPayjoin('psbt1', 'https://pj.example', 'mainnet');
      await payjoinApi.checkPayjoinEligibility('w1');

      expect(mockGet).toHaveBeenCalledWith('/payjoin/address/addr-id/uri', {});
      expect(mockGet).toHaveBeenCalledWith('/payjoin/address/addr-id/uri', {
        amount: '1000',
        label: 'Invoice',
        message: 'Order #1',
      });
      expect(mockPost).toHaveBeenCalledWith('/payjoin/parse-uri', { uri: 'bitcoin:bc1q...' });
      expect(mockPost).toHaveBeenCalledWith('/payjoin/attempt', {
        psbt: 'psbt1',
        payjoinUrl: 'https://pj.example',
        network: 'mainnet',
      });
      expect(mockGet).toHaveBeenCalledWith('/payjoin/eligibility/w1');
    });
  });

  describe('Price API', () => {
    it('calls price and conversion endpoints with params', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await priceApi.getPrice();
      await priceApi.getPrice('EUR', false);
      await priceApi.getMultiplePrices(['USD', 'EUR']);
      await priceApi.getPriceFromProvider('coingecko', 'JPY');
      await priceApi.convertToFiat({ sats: 100000, currency: 'USD' });
      await priceApi.convertToSats({ amount: 20, currency: 'USD' });
      await priceApi.getSupportedCurrencies();
      await priceApi.getProviders();
      await priceApi.checkProviderHealth();
      await priceApi.getCacheStats();
      await priceApi.clearCache();
      await priceApi.setCacheDuration(120);

      expect(mockGet).toHaveBeenCalledWith('/price', { currency: 'USD', useCache: 'true' });
      expect(mockGet).toHaveBeenCalledWith('/price', { currency: 'EUR', useCache: 'false' });
      expect(mockGet).toHaveBeenCalledWith('/price/multiple', { currencies: 'USD,EUR' });
      expect(mockGet).toHaveBeenCalledWith('/price/from/coingecko', { currency: 'JPY' });
      expect(mockPost).toHaveBeenCalledWith('/price/convert/to-fiat', { sats: 100000, currency: 'USD' });
      expect(mockPost).toHaveBeenCalledWith('/price/convert/to-sats', { amount: 20, currency: 'USD' });
      expect(mockGet).toHaveBeenCalledWith('/price/currencies');
      expect(mockGet).toHaveBeenCalledWith('/price/providers');
      expect(mockGet).toHaveBeenCalledWith('/price/health');
      expect(mockGet).toHaveBeenCalledWith('/price/cache/stats');
      expect(mockPost).toHaveBeenCalledWith('/price/cache/clear');
      expect(mockPost).toHaveBeenCalledWith('/price/cache/duration', { duration: 120 });
    });
  });

  describe('Sync API', () => {
    it('calls wallet and network sync endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await syncApi.syncWallet('w1');
      await syncApi.queueSync('w1');
      await syncApi.queueSync('w1', 'high');
      await syncApi.getSyncStatus('w1');
      await syncApi.queueUserWallets();
      await syncApi.queueUserWallets('low');
      await syncApi.resyncWallet('w1');
      await syncApi.syncNetworkWallets('mainnet');
      await syncApi.syncNetworkWallets('mainnet', 'high');
      await syncApi.resyncNetworkWallets('testnet');
      await syncApi.getNetworkSyncStatus('signet');

      expect(mockPost).toHaveBeenCalledWith('/sync/wallet/w1');
      expect(mockPost).toHaveBeenCalledWith('/sync/queue/w1', { priority: 'normal' });
      expect(mockPost).toHaveBeenCalledWith('/sync/queue/w1', { priority: 'high' });
      expect(mockGet).toHaveBeenCalledWith('/sync/status/w1');
      expect(mockPost).toHaveBeenCalledWith('/sync/user', { priority: 'normal' });
      expect(mockPost).toHaveBeenCalledWith('/sync/user', { priority: 'low' });
      expect(mockPost).toHaveBeenCalledWith('/sync/resync/w1');
      expect(mockPost).toHaveBeenCalledWith('/sync/network/mainnet', { priority: 'normal' });
      expect(mockPost).toHaveBeenCalledWith('/sync/network/mainnet', { priority: 'high' });
      expect(mockPost).toHaveBeenCalledWith(
        '/sync/network/testnet/resync',
        {},
        { headers: { 'X-Confirm-Resync': 'true' } }
      );
      expect(mockGet).toHaveBeenCalledWith('/sync/network/signet/status');
    });

    it('returns logs array from getWalletLogs', async () => {
      mockGet.mockResolvedValue({ logs: [{ level: 'info', message: 'ok' }] });
      const logs = await syncApi.getWalletLogs('w1');
      expect(logs).toEqual([{ level: 'info', message: 'ok' }]);
      expect(mockGet).toHaveBeenCalledWith('/sync/logs/w1');
    });
  });

  describe('Transfers API', () => {
    it('calls transfer endpoints and builds filters', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await transfersApi.initiateTransfer({
        resourceType: 'wallet',
        resourceId: 'w1',
        toUserId: 'u2',
      } as any);
      await transfersApi.getTransfers();
      await transfersApi.getTransfers({ role: 'sender', status: 'pending', resourceType: 'wallet' } as any);
      await transfersApi.getTransferCounts();
      await transfersApi.getTransfer('t1');
      await transfersApi.acceptTransfer('t1');
      await transfersApi.declineTransfer('t1', { reason: 'No thanks' });
      await transfersApi.cancelTransfer('t1');
      await transfersApi.confirmTransfer('t1');

      expect(mockPost).toHaveBeenCalledWith('/transfers', {
        resourceType: 'wallet',
        resourceId: 'w1',
        toUserId: 'u2',
      });
      expect(mockGet).toHaveBeenCalledWith('/transfers', {});
      expect(mockGet).toHaveBeenCalledWith('/transfers', {
        role: 'sender',
        status: 'pending',
        resourceType: 'wallet',
      });
      expect(mockGet).toHaveBeenCalledWith('/transfers/counts');
      expect(mockGet).toHaveBeenCalledWith('/transfers/t1');
      expect(mockPost).toHaveBeenCalledWith('/transfers/t1/accept');
      expect(mockPost).toHaveBeenCalledWith('/transfers/t1/decline', { reason: 'No thanks' });
      expect(mockPost).toHaveBeenCalledWith('/transfers/t1/cancel');
      expect(mockPost).toHaveBeenCalledWith('/transfers/t1/confirm');
    });

    it('covers transfer helper predicates and status mapping', () => {
      const pending = { status: 'pending', fromUserId: 'u1', toUserId: 'u2' } as any;
      const accepted = { status: 'accepted', fromUserId: 'u1', toUserId: 'u2' } as any;
      const confirmed = { status: 'confirmed', fromUserId: 'u1', toUserId: 'u2' } as any;

      expect(transfersApi.isTransferActive(pending)).toBe(true);
      expect(transfersApi.isTransferActive(confirmed)).toBe(false);
      expect(transfersApi.canAcceptTransfer(pending, 'u2')).toBe(true);
      expect(transfersApi.canAcceptTransfer(pending, 'u3')).toBe(false);
      expect(transfersApi.canConfirmTransfer(accepted, 'u1')).toBe(true);
      expect(transfersApi.canCancelTransfer(accepted, 'u1')).toBe(true);
      expect(transfersApi.canCancelTransfer(confirmed, 'u1')).toBe(false);

      expect(transfersApi.getTransferStatusInfo('pending')).toEqual({ label: 'Pending Acceptance', color: 'warning' });
      expect(transfersApi.getTransferStatusInfo('accepted')).toEqual({ label: 'Awaiting Confirmation', color: 'info' });
      expect(transfersApi.getTransferStatusInfo('confirmed')).toEqual({ label: 'Completed', color: 'success' });
      expect(transfersApi.getTransferStatusInfo('cancelled')).toEqual({ label: 'Cancelled', color: 'error' });
      expect(transfersApi.getTransferStatusInfo('declined')).toEqual({ label: 'Declined', color: 'error' });
      expect(transfersApi.getTransferStatusInfo('expired')).toEqual({ label: 'Expired', color: 'error' });
      expect(transfersApi.getTransferStatusInfo('mystery')).toEqual({ label: 'mystery', color: 'info' });
    });
  });

  describe('Two-Factor API', () => {
    it('calls setup, enable, disable, verify, and backup endpoints', async () => {
      // Phase 4: verify2FA no longer sets a JS token — the backend sets
      // browser auth cookies on this response and the ApiClient parses
      // X-Access-Expires-At from the headers. The helper just returns
      // the response payload.
      mockPost.mockResolvedValue({});

      await twoFactorApi.setup2FA();
      await twoFactorApi.enable2FA('123456');
      await twoFactorApi.disable2FA({ password: 'p', token: '123456' });

      const verifyResponse = { token: 'jwt-2fa', user: { id: 'u1' } };
      mockPost.mockResolvedValueOnce(verifyResponse);
      const result = await twoFactorApi.verify2FA({ tempToken: 'tmp', code: '111111' });

      await twoFactorApi.getBackupCodesCount('password');
      await twoFactorApi.regenerateBackupCodes({ password: 'password', token: '222222' });

      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/setup', {});
      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/enable', { token: '123456' });
      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/disable', { password: 'p', token: '123456' });
      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/verify', { tempToken: 'tmp', code: '111111' });
      expect(result).toEqual(verifyResponse);
      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/backup-codes', { password: 'password' });
      expect(mockPost).toHaveBeenCalledWith('/auth/2fa/backup-codes/regenerate', { password: 'password', token: '222222' });
    });
  });

  describe('Admin Backup API', () => {
    it('calls backup, audit, and version endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await adminBackupApi.getEncryptionKeys('test-password');
      await adminBackupApi.createBackupJson({ includeSettings: true } as any);
      await adminBackupApi.validateBackup({ meta: {} } as any);
      await adminBackupApi.restoreBackup({ meta: {} } as any);
      await adminBackupApi.getAuditLogs({
        userId: 'u1',
        username: 'alice',
        action: 'login',
        category: 'auth',
        success: true,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        limit: 10,
        offset: 20,
      });
      await adminBackupApi.getAuditLogStats();
      await adminBackupApi.getAuditLogStats(7);
      await adminBackupApi.checkVersion();

      expect(mockPost).toHaveBeenCalledWith('/admin/encryption-keys', { password: 'test-password' });
      expect(mockPost).toHaveBeenCalledWith('/admin/backup', { includeSettings: true });
      expect(mockPost).toHaveBeenCalledWith('/admin/backup/validate', { backup: { meta: {} } });
      expect(mockPost).toHaveBeenCalledWith('/admin/restore', {
        backup: { meta: {} },
        confirmationCode: 'CONFIRM_RESTORE',
      });
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs?userId=u1&username=alice&action=login&category=auth&success=true&startDate=2026-01-01&endDate=2026-01-31&limit=10&offset=20');
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs/stats');
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs/stats?days=7');
      expect(mockGet).toHaveBeenCalledWith('/admin/version');
    });

    it('creates backup blob via fetch with cookie credentials and throws on error', async () => {
      // Phase 4: createBackup sends `credentials: 'include'` so the
      // browser attaches the sanctuary_access cookie automatically; the
      // legacy Authorization: Bearer header is gone. CSRF token is read
      // from the sanctuary_csrf cookie when available.
      const blob = new Blob(['backup-data'], { type: 'application/json' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(blob),
      });

      const result = await adminBackupApi.createBackup({ includeAuditLogs: true } as any);
      expect(result).toEqual(blob);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('/api/v1/admin/backup');
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.credentials).toBe('include');
      expect(calledOptions.headers['Content-Type']).toBe('application/json');
      expect(calledOptions.headers['Authorization']).toBeUndefined();
      expect(calledOptions.body).toBe(JSON.stringify({ includeAuditLogs: true }));

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Backup failed' }),
      });
      await expect(adminBackupApi.createBackup()).rejects.toThrow('Backup failed');
    });

    it('createBackup sends X-CSRF-Token header when sanctuary_csrf cookie is set', async () => {
      // Phase 4: createBackup reads the sanctuary_csrf cookie and
      // injects the X-CSRF-Token header on the POST. Same defense
      // every other state-changing browser request gets.
      document.cookie = 'sanctuary_csrf=csrf-from-document; path=/';
      const blob = new Blob(['backup-data'], { type: 'application/json' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(blob),
      });

      await adminBackupApi.createBackup();

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.credentials).toBe('include');
      expect(calledOptions.headers['X-CSRF-Token']).toBe('csrf-from-document');

      // Cleanup
      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('createBackup parses a multi-entry Cookie header to extract sanctuary_csrf', async () => {
      document.cookie = 'unrelated=value; path=/';
      document.cookie = 'sanctuary_csrf=needed%2Bvalue; path=/';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(['ok'])),
      });

      await adminBackupApi.createBackup();

      const calledOptions = mockFetch.mock.calls[0][1];
      // decodeURIComponent should turn '%2B' back into '+'.
      expect(calledOptions.headers['X-CSRF-Token']).toBe('needed+value');

      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'unrelated=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('createBackup omits X-CSRF-Token when the cookie jar has other cookies but no sanctuary_csrf', async () => {
      // Exercises the "loop completed without finding sanctuary_csrf"
      // branch in readCsrfCookieValue (the explicit `return null` at
      // the end of the function, not the early-return for an empty
      // document.cookie).
      document.cookie = 'cookie1=foo; path=/';
      document.cookie = 'cookie2=bar; path=/';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(['ok'])),
      });

      await adminBackupApi.createBackup();

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBeUndefined();

      document.cookie = 'cookie1=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'cookie2=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('covers backup API fallback and optional query branches', async () => {
      mockPost.mockResolvedValue({});
      mockGet.mockResolvedValue({});

      // createBackupJson defaults to empty options object
      await adminBackupApi.createBackupJson();
      expect(mockPost).toHaveBeenCalledWith('/admin/backup', {});

      // getAuditLogs with no query uses base URL
      await adminBackupApi.getAuditLogs();
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs');

      // success omitted should not append success query param
      await adminBackupApi.getAuditLogs({ userId: 'u-omitted-success' });
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs?userId=u-omitted-success');

      // success=false should still be included; limit/offset=0 should be omitted by truthy checks
      await adminBackupApi.getAuditLogs({
        success: false,
        limit: 0,
        offset: 0,
      });
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs?success=false');

      // days=0 uses fallback stats endpoint without query param
      await adminBackupApi.getAuditLogStats(0);
      expect(mockGet).toHaveBeenCalledWith('/admin/audit-logs/stats');

      // createBackup with no options sends empty object and falls back to default error text
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });
      await expect(adminBackupApi.createBackup()).rejects.toThrow('Backup creation failed');
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('/api/v1/admin/backup');
      expect(lastCall[1].method).toBe('POST');
      expect(lastCall[1].credentials).toBe('include');
      expect(lastCall[1].headers['Content-Type']).toBe('application/json');
      expect(lastCall[1].headers['Authorization']).toBeUndefined();
      expect(lastCall[1].body).toBe(JSON.stringify({}));
    });
  });

  describe('Admin Settings/Monitoring/Groups/Users APIs', () => {
    it('calls settings and node config endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await adminSettingsApi.getSystemSettings();
      await adminSettingsApi.updateSystemSettings({ registrationEnabled: false } as any);
      await adminSettingsApi.getNodeConfig();
      await adminSettingsApi.updateNodeConfig({} as any);
      await adminSettingsApi.testNodeConfig({} as any);
      await adminSettingsApi.getElectrumServers();
      await adminSettingsApi.getElectrumServers('mainnet');
      await adminSettingsApi.addElectrumServer({
        label: 'Server',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        network: 'mainnet',
        enabled: true,
        priority: 1,
      } as any);
      await adminSettingsApi.updateElectrumServer('s1', { enabled: false });
      await adminSettingsApi.deleteElectrumServer('s1');
      await adminSettingsApi.testElectrumServer('s1');
      await adminSettingsApi.reorderElectrumServers(['s1', 's2']);
      await adminSettingsApi.testElectrumConnection({ host: 'e', port: 50002, useSsl: true });
      await adminSettingsApi.testProxy({ host: '127.0.0.1', port: 9050 });

      expect(mockGet).toHaveBeenCalledWith('/admin/settings');
      expect(mockPut).toHaveBeenCalledWith('/admin/settings', { registrationEnabled: false });
      expect(mockGet).toHaveBeenCalledWith('/admin/node-config');
      expect(mockPut).toHaveBeenCalledWith('/admin/node-config', {});
      expect(mockPost).toHaveBeenCalledWith('/admin/node-config/test', {});
      expect(mockGet).toHaveBeenCalledWith('/admin/electrum-servers');
      expect(mockGet).toHaveBeenCalledWith('/admin/electrum-servers?network=mainnet');
      expect(mockPost).toHaveBeenCalledWith('/admin/electrum-servers', {
        label: 'Server',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        network: 'mainnet',
        enabled: true,
        priority: 1,
      });
      expect(mockPut).toHaveBeenCalledWith('/admin/electrum-servers/s1', { enabled: false });
      expect(mockDelete).toHaveBeenCalledWith('/admin/electrum-servers/s1');
      expect(mockPost).toHaveBeenCalledWith('/admin/electrum-servers/s1/test');
      expect(mockPut).toHaveBeenCalledWith('/admin/electrum-servers/reorder', { serverIds: ['s1', 's2'] });
      expect(mockPost).toHaveBeenCalledWith('/admin/electrum-servers/test-connection', {
        host: 'e',
        port: 50002,
        useSsl: true,
      });
      expect(mockPost).toHaveBeenCalledWith('/admin/proxy/test', { host: '127.0.0.1', port: 9050 });
    });

    it('calls monitoring, group, and user admin endpoints', async () => {
      mockGet.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await adminMonitoringApi.getMonitoringServices();
      await adminMonitoringApi.getMonitoringServices(true);
      await adminMonitoringApi.updateMonitoringServiceUrl('svc1', 'https://grafana.example');
      await adminMonitoringApi.getGrafanaConfig();
      await adminMonitoringApi.updateGrafanaConfig({ anonymousAccess: true });
      await adminMonitoringApi.getWebSocketStats();
      await adminMonitoringApi.getTorContainerStatus();
      await adminMonitoringApi.startTorContainer();
      await adminMonitoringApi.stopTorContainer();

      await adminGroupsApi.getGroups();
      await adminGroupsApi.createGroup({ name: 'Ops' });
      await adminGroupsApi.updateGroup('g1', { name: 'Ops 2' });
      await adminGroupsApi.deleteGroup('g1');
      await adminGroupsApi.addGroupMember('g1', 'u1', 'member');
      await adminGroupsApi.removeGroupMember('g1', 'u1');

      await adminUsersApi.getUsers();
      await adminUsersApi.createUser({ username: 'alice', password: 'secret' } as any);
      await adminUsersApi.updateUser('u1', { isAdmin: true } as any);
      await adminUsersApi.deleteUser('u1');

      expect(mockGet).toHaveBeenCalledWith('/admin/monitoring/services');
      expect(mockGet).toHaveBeenCalledWith('/admin/monitoring/services?checkHealth=true');
      expect(mockPut).toHaveBeenCalledWith('/admin/monitoring/services/svc1', { customUrl: 'https://grafana.example' });
      expect(mockGet).toHaveBeenCalledWith('/admin/monitoring/grafana');
      expect(mockPut).toHaveBeenCalledWith('/admin/monitoring/grafana', { anonymousAccess: true });
      expect(mockGet).toHaveBeenCalledWith('/admin/websocket/stats');
      expect(mockGet).toHaveBeenCalledWith('/admin/tor-container/status');
      expect(mockPost).toHaveBeenCalledWith('/admin/tor-container/start', {});
      expect(mockPost).toHaveBeenCalledWith('/admin/tor-container/stop', {});

      expect(mockGet).toHaveBeenCalledWith('/admin/groups');
      expect(mockPost).toHaveBeenCalledWith('/admin/groups', { name: 'Ops' });
      expect(mockPut).toHaveBeenCalledWith('/admin/groups/g1', { name: 'Ops 2' });
      expect(mockDelete).toHaveBeenCalledWith('/admin/groups/g1');
      expect(mockPost).toHaveBeenCalledWith('/admin/groups/g1/members', { userId: 'u1', role: 'member' });
      expect(mockDelete).toHaveBeenCalledWith('/admin/groups/g1/members/u1');

      expect(mockGet).toHaveBeenCalledWith('/admin/users');
      expect(mockPost).toHaveBeenCalledWith('/admin/users', { username: 'alice', password: 'secret' });
      expect(mockPut).toHaveBeenCalledWith('/admin/users/u1', { isAdmin: true });
      expect(mockDelete).toHaveBeenCalledWith('/admin/users/u1');
    });
  });

  describe('Admin Feature Flags API', () => {
    it('calls feature flag CRUD endpoints', async () => {
      mockGet.mockResolvedValue([]);
      mockPatch.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await adminFeaturesApi.getFeatureFlags();
      await adminFeaturesApi.updateFeatureFlag('aiAssistant', true, 'Testing');
      await adminFeaturesApi.resetFeatureFlag('aiAssistant');
      await adminFeaturesApi.getFeatureFlagAuditLog();

      expect(mockGet).toHaveBeenCalledWith('/admin/features');
      expect(mockPatch).toHaveBeenCalledWith('/admin/features/aiAssistant', {
        enabled: true,
        reason: 'Testing',
      });
      expect(mockPost).toHaveBeenCalledWith('/admin/features/aiAssistant/reset');
      expect(mockGet).toHaveBeenCalledWith('/admin/features/audit-log');
    });

    it('passes optional key and limit to audit log', async () => {
      mockGet.mockResolvedValue({ entries: [], total: 0, limit: 10, offset: 0 });

      await adminFeaturesApi.getFeatureFlagAuditLog('treasuryAutopilot', 10);

      expect(mockGet).toHaveBeenCalledWith('/admin/features/audit-log?key=treasuryAutopilot&limit=10');
    });

    it('omits query params when not provided', async () => {
      mockGet.mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });

      await adminFeaturesApi.getFeatureFlagAuditLog();

      expect(mockGet).toHaveBeenCalledWith('/admin/features/audit-log');
    });

    it('calls updateFeatureFlag without reason', async () => {
      mockPatch.mockResolvedValue({});

      await adminFeaturesApi.updateFeatureFlag('priceAlerts', false);

      expect(mockPatch).toHaveBeenCalledWith('/admin/features/priceAlerts', {
        enabled: false,
        reason: undefined,
      });
    });
  });
});

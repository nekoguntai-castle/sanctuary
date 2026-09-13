import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockGetWalletTelegramSettings,
  mockUpdateWalletTelegramSettings,
} = vi.hoisted(() => ({
  mockGetWalletTelegramSettings: vi.fn(),
  mockUpdateWalletTelegramSettings: vi.fn(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/services/telegram/telegramService', () => ({
  getWalletTelegramSettings: mockGetWalletTelegramSettings,
  updateWalletTelegramSettings: mockUpdateWalletTelegramSettings,
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
import walletsTelegramRouter from '../../../src/api/wallets/telegram';

describe('Wallets Telegram Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1/wallets', walletsTelegramRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWalletTelegramSettings.mockResolvedValue({
      enabled: true,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: true,
    });
    mockUpdateWalletTelegramSettings.mockResolvedValue(undefined);
  });

  it('returns existing wallet telegram settings', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/telegram');

    expect(response.status).toBe(200);
    expect(mockGetWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1');
    expect(response.body).toEqual({
      settings: {
        enabled: true,
        notifyReceived: false,
        notifySent: true,
        notifyConsolidation: false,
        notifyDraft: true,
      },
    });
  });

  it('returns default wallet telegram settings when user has no saved preferences', async () => {
    mockGetWalletTelegramSettings.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/telegram');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      settings: {
        enabled: false,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: true,
        notifyDraft: true,
      },
    });
  });

  it('handles errors when reading wallet telegram settings', async () => {
    mockGetWalletTelegramSettings.mockRejectedValue(new Error('database unavailable'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/telegram');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('updates wallet telegram settings with explicit values', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({
        enabled: true,
        notifyReceived: false,
        notifySent: false,
        notifyConsolidation: true,
        notifyDraft: false,
      });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
      notifyReceived: false,
      notifySent: false,
      notifyConsolidation: true,
      notifyDraft: false,
    });
    expect(response.body).toEqual({
      success: true,
      message: 'Telegram settings updated',
    });
  });

  it('merges an empty patch onto the stored settings instead of resetting to defaults', async () => {
    // beforeEach stores { enabled: true, notifyReceived: false, notifySent: true,
    // notifyConsolidation: false, notifyDraft: true }; an empty patch must preserve it.
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({});

    expect(response.status).toBe(200);
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: true,
    });
  });

  it('applies default values when telegram settings fields are omitted and nothing is stored', async () => {
    mockGetWalletTelegramSettings.mockResolvedValueOnce(null);

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({});

    expect(response.status).toBe(200);
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: false,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    });
  });

  it('preserves notifySent from the stored settings when only enabled is patched', async () => {
    // Regression test for autopilot-telegram-patch-resets-omitted-fields-to-defaults:
    // storing notifySent: true and patching only `enabled` used to reset the
    // other notify* fields back to their hardcoded defaults.
    mockGetWalletTelegramSettings.mockResolvedValueOnce({
      enabled: false,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: false,
    });

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({ enabled: true });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: false,
    });
  });

  it('handles errors when updating wallet telegram settings', async () => {
    mockUpdateWalletTelegramSettings.mockRejectedValue(new Error('write failed'));

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({ enabled: true });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});

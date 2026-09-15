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
  DEFAULT_WALLET_TELEGRAM_SETTINGS: {
    enabled: false,
    notifyReceived: true,
    notifySent: true,
    notifyConsolidation: true,
    notifyDraft: true,
  },
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

  it('forwards an empty patch body unchanged without pre-reading stored settings', async () => {
    // Regression test for telegram-wallet-settings-patch-stale-read-lost-update:
    // the route used to pre-read `stored` via GET and merge onto it before
    // calling the service; that stale read is what caused concurrent PATCHes
    // to clobber each other's committed fields. The DEFAULT -> stored -> patch
    // merge now happens inside updateWalletTelegramSettings, against a fresh
    // re-read, so the route must forward the raw patch and never call GET.
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({});

    expect(response.status).toBe(200);
    expect(mockGetWalletTelegramSettings).not.toHaveBeenCalled();
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {});
  });

  it('forwards a partial patch body unchanged without pre-reading stored settings', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/telegram')
      .send({ enabled: true });

    expect(response.status).toBe(200);
    expect(mockGetWalletTelegramSettings).not.toHaveBeenCalled();
    expect(mockUpdateWalletTelegramSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
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

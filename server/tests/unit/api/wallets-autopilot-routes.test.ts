import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockGetWalletAutopilotSettings,
  mockUpdateWalletAutopilotSettings,
  mockGetUtxoHealthProfile,
  mockGetLatestFeeSnapshot,
} = vi.hoisted(() => ({
  mockGetWalletAutopilotSettings: vi.fn(),
  mockUpdateWalletAutopilotSettings: vi.fn(),
  mockGetUtxoHealthProfile: vi.fn(),
  mockGetLatestFeeSnapshot: vi.fn(),
}));

vi.mock('../../../src/middleware/featureGate', () => ({
  requireFeature: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/services/autopilot/settings', () => ({
  getWalletAutopilotSettings: mockGetWalletAutopilotSettings,
  updateWalletAutopilotSettings: mockUpdateWalletAutopilotSettings,
}));

vi.mock('../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: mockGetUtxoHealthProfile,
}));

vi.mock('../../../src/services/autopilot/feeMonitor', () => ({
  getLatestFeeSnapshot: mockGetLatestFeeSnapshot,
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
import autopilotRouter from '../../../src/api/wallets/autopilot';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../../src/services/autopilot/types';

describe('Wallets Autopilot Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1/wallets', autopilotRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWalletAutopilotSettings.mockResolvedValue({
      enabled: true,
      maxFeeRate: 7,
      minUtxoCount: 15,
      dustThreshold: 8000,
      cooldownHours: 12,
      notifyTelegram: false,
      notifyPush: true,
      minDustCount: 0,
      maxUtxoSize: 0,
    });
    mockUpdateWalletAutopilotSettings.mockResolvedValue(undefined);
    mockGetUtxoHealthProfile.mockResolvedValue({
      totalUtxos: 12,
      dustCount: 2,
      dustValue: 5000n,
      totalValue: 120_000n,
      avgUtxoSize: 10_000n,
      smallestUtxo: 1000n,
      largestUtxo: 25_000n,
      consolidationCandidates: 12,
    });
    mockGetLatestFeeSnapshot.mockResolvedValue({
      timestamp: 1,
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
      minimum: 2,
    });
  });

  it('returns wallet autopilot settings', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot');

    expect(response.status).toBe(200);
    expect(mockGetWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1');
    expect(response.body.settings).toEqual({
      enabled: true,
      maxFeeRate: 7,
      minUtxoCount: 15,
      dustThreshold: 8000,
      cooldownHours: 12,
      notifyTelegram: false,
      notifyPush: true,
      minDustCount: 0,
      maxUtxoSize: 0,
    });
  });

  it('falls back to defaults when wallet settings are not stored', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot');

    expect(response.status).toBe(200);
    expect(response.body.settings).toEqual({
      enabled: false,
      maxFeeRate: 5,
      minUtxoCount: 10,
      dustThreshold: 10000,
      cooldownHours: 24,
      notifyTelegram: true,
      notifyPush: true,
      minDustCount: 0,
      maxUtxoSize: 0,
    });
  });

  it('updates settings and merges omitted patch fields onto the stored settings', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true, maxFeeRate: 3, notifyTelegram: false });

    expect(response.status).toBe(200);
    // Omitted fields (minUtxoCount, dustThreshold, cooldownHours, notifyPush,
    // minDustCount, maxUtxoSize) come from the stored settings set up in
    // beforeEach, not from DEFAULT_AUTOPILOT_SETTINGS.
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
      maxFeeRate: 3,
      minUtxoCount: 15,
      dustThreshold: 8000,
      cooldownHours: 12,
      notifyTelegram: false,
      notifyPush: true,
      minDustCount: 0,
      maxUtxoSize: 0,
    });
    expect(response.body).toEqual({
      success: true,
      message: 'Autopilot settings updated',
    });
  });

  it('preserves an unrelated stored field instead of resetting it to the default on PATCH', async () => {
    // Regression test for autopilot-telegram-patch-resets-omitted-fields-to-defaults:
    // storing minDustCount: 7 and then patching an unrelated field used to reset
    // minDustCount back to DEFAULT_AUTOPILOT_SETTINGS.minDustCount (0).
    mockGetWalletAutopilotSettings.mockResolvedValueOnce({
      enabled: true,
      maxFeeRate: 5,
      minUtxoCount: 10,
      dustThreshold: 10000,
      cooldownHours: 24,
      notifyTelegram: true,
      notifyPush: true,
      minDustCount: 7,
      maxUtxoSize: 0,
    });

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ notifyPush: false });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1',
      expect.objectContaining({
        minDustCount: 7,
        notifyPush: false,
      })
    );
  });

  it('falls back to defaults on PATCH when nothing is stored', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce(null);

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ notifyPush: false });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      ...DEFAULT_AUTOPILOT_SETTINGS,
      notifyPush: false,
    });
  });

  it('returns autopilot status with bigint values serialized as strings', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(200);
    expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('wallet-1', 8000, 0);
    expect(response.body).toEqual({
      utxoHealth: {
        totalUtxos: 12,
        dustCount: 2,
        dustValue: '5000',
        totalValue: '120000',
        avgUtxoSize: '10000',
        smallestUtxo: '1000',
        largestUtxo: '25000',
        consolidationCandidates: 12,
      },
      feeSnapshot: {
        timestamp: 1,
        fastest: 20,
        halfHour: 15,
        hour: 10,
        economy: 5,
        minimum: 2,
      },
      settings: {
        enabled: true,
        maxFeeRate: 7,
        minUtxoCount: 15,
        dustThreshold: 8000,
        cooldownHours: 12,
        notifyTelegram: false,
        notifyPush: true,
        minDustCount: 0,
        maxUtxoSize: 0,
      },
    });
  });

  it('uses default dust threshold in status endpoint when no settings exist', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(200);
    expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('wallet-1', 10000, 0);
  });

  it('falls back to default enabled when enabled is omitted from PATCH body and nothing is stored', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce(null);

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ maxFeeRate: 8 });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1',
      expect.objectContaining({
        enabled: false, // DEFAULT_AUTOPILOT_SETTINGS.enabled
        maxFeeRate: 8,
      })
    );
  });

  it('accepts minDustCount and maxUtxoSize in PATCH', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true, minDustCount: 5, maxUtxoSize: 50000 });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1',
      expect.objectContaining({
        minDustCount: 5,
        maxUtxoSize: 50000,
      })
    );
  });

  it('passes maxUtxoSize from settings to health profile in status endpoint', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce({
      enabled: true,
      maxFeeRate: 7,
      minUtxoCount: 15,
      dustThreshold: 8000,
      cooldownHours: 12,
      notifyTelegram: false,
      notifyPush: true,
      minDustCount: 3,
      maxUtxoSize: 50000,
    });

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(200);
    expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('wallet-1', 8000, 50000);
    expect(response.body.utxoHealth).toHaveProperty('consolidationCandidates');
  });

  it('returns 500 on settings read failures', async () => {
    mockGetWalletAutopilotSettings.mockRejectedValueOnce(new Error('db unavailable'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 on settings update failures', async () => {
    mockUpdateWalletAutopilotSettings.mockRejectedValueOnce(new Error('write failed'));

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 on status computation failures', async () => {
    mockGetUtxoHealthProfile.mockRejectedValueOnce(new Error('utxo lookup failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});

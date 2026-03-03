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

import autopilotRouter from '../../../src/api/wallets/autopilot';

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
    });
  });

  it('updates settings and applies defaults to omitted patch fields', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true, maxFeeRate: 3, notifyTelegram: false });

    expect(response.status).toBe(200);
    expect(mockUpdateWalletAutopilotSettings).toHaveBeenCalledWith('user-1', 'wallet-1', {
      enabled: true,
      maxFeeRate: 3,
      minUtxoCount: 10,
      dustThreshold: 10000,
      cooldownHours: 24,
      notifyTelegram: false,
      notifyPush: true,
    });
    expect(response.body).toEqual({
      success: true,
      message: 'Autopilot settings updated',
    });
  });

  it('returns autopilot status with bigint values serialized as strings', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(200);
    expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('wallet-1', 8000);
    expect(response.body).toEqual({
      utxoHealth: {
        totalUtxos: 12,
        dustCount: 2,
        dustValue: '5000',
        totalValue: '120000',
        avgUtxoSize: '10000',
        smallestUtxo: '1000',
        largestUtxo: '25000',
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
      },
    });
  });

  it('uses default dust threshold in status endpoint when no settings exist', async () => {
    mockGetWalletAutopilotSettings.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(200);
    expect(mockGetUtxoHealthProfile).toHaveBeenCalledWith('wallet-1', 10000);
  });

  it('returns 500 on settings read failures', async () => {
    mockGetWalletAutopilotSettings.mockRejectedValueOnce(new Error('db unavailable'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to get autopilot settings',
    });
  });

  it('returns 500 on settings update failures', async () => {
    mockUpdateWalletAutopilotSettings.mockRejectedValueOnce(new Error('write failed'));

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to update autopilot settings',
    });
  });

  it('returns 500 on status computation failures', async () => {
    mockGetUtxoHealthProfile.mockRejectedValueOnce(new Error('utxo lookup failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/autopilot/status');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to get autopilot status',
    });
  });
});

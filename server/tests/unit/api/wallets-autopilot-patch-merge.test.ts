import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Regression tests for telegram-wallet-settings-patch-stale-read-lost-update
 * (autopilot has the identical shape as the telegram finding). Unlike
 * wallets-autopilot-routes.test.ts (which mocks the autopilot service
 * itself), this file mocks only the repository layer and exercises the real
 * router -> real service -> updatePreferencesAtomically path end to end, so
 * it can prove that a single-field PATCH does not clobber a field committed
 * by a concurrent PATCH.
 */

const { mockUserRepo } = vi.hoisted(() => ({
  mockUserRepo: {
    findByIdWithSelect: vi.fn(),
    updatePreferences: vi.fn(),
    updatePreferencesAtomically: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  userRepository: mockUserRepo,
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../src/middleware/featureGate', () => ({
  requireFeature: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: vi.fn(),
}));

vi.mock('../../../src/services/autopilot/feeMonitor', () => ({
  getLatestFeeSnapshot: vi.fn(),
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

describe('Wallets Autopilot PATCH — concurrent-commit merge (repository-level)', () => {
  let app: Express;
  let dbPreferences: unknown;

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
    dbPreferences = {};
    (mockUserRepo.updatePreferencesAtomically as Mock).mockImplementation(
      async (_userId: string, updater: (preferences: unknown) => { preferences: unknown; result: unknown }) => {
        // The real repository re-reads inside the transaction and re-runs
        // the updater against that fresh row on every attempt. Simulate the
        // "fresh read" by always handing the updater the currently
        // committed state, not any earlier snapshot the caller might hold.
        const update = updater(dbPreferences);
        dbPreferences = update.preferences;
        return { user: {}, result: update.result };
      },
    );
  });

  it('a single-field PATCH does not reset a field committed by a concurrent PATCH', async () => {
    const first = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ enabled: true });
    expect(first.status).toBe(200);

    // Simulates a second PATCH landing after the first has committed
    // (e.g. a concurrent request, or the same request retried after a
    // serializable conflict) — it only names notifyPush, so enabled must
    // survive.
    const second = await request(app)
      .patch('/api/v1/wallets/wallet-1/autopilot')
      .send({ notifyPush: false });
    expect(second.status).toBe(200);

    const prefs = dbPreferences as { autopilot: { wallets: Record<string, unknown> } };
    expect(prefs.autopilot.wallets['wallet-1']).toEqual(
      expect.objectContaining({ enabled: true, notifyPush: false }),
    );
  });
});

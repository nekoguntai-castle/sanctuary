/**
 * Wallet Transactions - Recalculate Route Tests
 *
 * Regression coverage for `recalculate-endpoint-mutates-with-view-only-access`:
 * POST /wallets/:walletId/transactions/recalculate mutates stored balances
 * (via recalculateWalletBalances) but previously only required `view` access,
 * so a view-only wallet share could trigger a write. This exercises the real
 * `requireWalletAccess` middleware (only `getUserWalletRole` is mocked) so the
 * access-level enforcement itself is under test, not bypassed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockGetUserWalletRole, mockRecalculateWalletBalances, mockFindLastByWalletId } = vi.hoisted(() => ({
  mockGetUserWalletRole: vi.fn(),
  mockRecalculateWalletBalances: vi.fn(),
  mockFindLastByWalletId: vi.fn(),
}));

vi.mock('../../../src/services/wallet', () => ({
  getUserWalletRole: mockGetUserWalletRole,
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  recalculateWalletBalances: mockRecalculateWalletBalances,
}));

vi.mock('../../../src/repositories', () => ({
  transactionRepository: {
    findLastByWalletId: mockFindLastByWalletId,
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
import { createRecalculateRouter } from '../../../src/api/transactions/walletTransactions/recalculate';

describe('Wallet Transactions Recalculate Route', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
      next();
    });
    app.use('/api/v1', createRecalculateRouter());
    app.use(errorHandler);

    mockRecalculateWalletBalances.mockResolvedValue(undefined);
    mockFindLastByWalletId.mockResolvedValue({ id: 'tx-1', balanceAfter: 100000000n });
  });

  it('returns 403 and does not mutate balances for a view-only wallet share', async () => {
    mockGetUserWalletRole.mockResolvedValue('viewer');

    const response = await request(app).post('/api/v1/wallets/wallet-1/transactions/recalculate');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'You do not have permission to access this wallet',
    });
    expect(mockRecalculateWalletBalances).not.toHaveBeenCalled();
  });

  it('recalculates balances for a wallet share with edit access', async () => {
    mockGetUserWalletRole.mockResolvedValue('signer');

    const response = await request(app).post('/api/v1/wallets/wallet-1/transactions/recalculate');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Balances recalculated',
      finalBalance: 100000000,
      finalBalanceBtc: 1,
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith('wallet-1');
  });
});

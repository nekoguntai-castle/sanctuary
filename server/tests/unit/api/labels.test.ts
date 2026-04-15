/**
 * Tests for labels.ts API routes
 * Tests label CRUD operations for wallets, transactions, and addresses
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// Mock auth middleware (pass-through for route tests)
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
    next();
  },
}));

// Mock wallet access middleware (pass-through for route tests)
vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId || req.params.id;
    req.walletRole = 'owner';
    next();
  },
}));

// Mock label service
const mockGetLabelsForWallet = vi.fn();
const mockGetLabel = vi.fn();
const mockCreateLabel = vi.fn();
const mockUpdateLabel = vi.fn();
const mockDeleteLabel = vi.fn();
const mockGetTransactionLabels = vi.fn();
const mockAddTransactionLabels = vi.fn();
const mockReplaceTransactionLabels = vi.fn();
const mockRemoveTransactionLabel = vi.fn();
const mockGetAddressLabels = vi.fn();
const mockAddAddressLabels = vi.fn();
const mockReplaceAddressLabels = vi.fn();
const mockRemoveAddressLabel = vi.fn();

vi.mock('../../../src/services/labelService', () => ({
  labelService: {
    getLabelsForWallet: (...args: unknown[]) => mockGetLabelsForWallet(...args),
    getLabel: (...args: unknown[]) => mockGetLabel(...args),
    createLabel: (...args: unknown[]) => mockCreateLabel(...args),
    updateLabel: (...args: unknown[]) => mockUpdateLabel(...args),
    deleteLabel: (...args: unknown[]) => mockDeleteLabel(...args),
    getTransactionLabels: (...args: unknown[]) => mockGetTransactionLabels(...args),
    addTransactionLabels: (...args: unknown[]) => mockAddTransactionLabels(...args),
    replaceTransactionLabels: (...args: unknown[]) => mockReplaceTransactionLabels(...args),
    removeTransactionLabel: (...args: unknown[]) => mockRemoveTransactionLabel(...args),
    getAddressLabels: (...args: unknown[]) => mockGetAddressLabels(...args),
    addAddressLabels: (...args: unknown[]) => mockAddAddressLabels(...args),
    replaceAddressLabels: (...args: unknown[]) => mockReplaceAddressLabels(...args),
    removeAddressLabel: (...args: unknown[]) => mockRemoveAddressLabel(...args),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
  },
}));

// Import router after mocks
import labelsRouter from '../../../src/api/labels';
import { NotFoundError, ForbiddenError, errorHandler } from '../../../src/errors';

describe('Labels API Routes', () => {
  let app: Express;

  const mockLabel = {
    id: 'label-1',
    name: 'Exchange',
    color: '#FF5733',
    description: 'Exchange transactions',
    walletId: 'wallet-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLabelWithRelations = {
    ...mockLabel,
    transactions: [
      { id: 'tx-1', txid: 'abc123', amount: BigInt(100000) },
    ],
    addresses: [
      { id: 'addr-1', address: 'bc1q...' },
    ],
  };

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', labelsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // WALLET LABEL CRUD
  // ========================================

  describe('GET /wallets/:walletId/labels', () => {
    it('should return labels for wallet', async () => {
      mockGetLabelsForWallet.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/labels');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Exchange');
      expect(mockGetLabelsForWallet).toHaveBeenCalledWith('wallet-1');
    });

    it('should return 404 when wallet not found', async () => {
      mockGetLabelsForWallet.mockRejectedValue(new NotFoundError('Wallet not found'));

      const response = await request(app)
        .get('/api/v1/wallets/nonexistent/labels');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockGetLabelsForWallet.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/labels');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /wallets/:walletId/labels/:labelId', () => {
    it('should return label with relations', async () => {
      mockGetLabel.mockResolvedValue(mockLabelWithRelations);

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/labels/label-1');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Exchange');
      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.transactions[0].amount).toBe(100000);
      expect(mockGetLabel).toHaveBeenCalledWith('wallet-1', 'label-1');
    });

    it('should return 404 when label not found', async () => {
      mockGetLabel.mockRejectedValue(new NotFoundError('Label not found'));

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/labels/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockGetLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/wallets/wallet-1/labels/label-1');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /wallets/:walletId/labels', () => {
    it('should create a new label', async () => {
      mockCreateLabel.mockResolvedValue(mockLabel);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/labels')
        .send({ name: 'Exchange', color: '#FF5733', description: 'Exchange transactions' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Exchange');
      expect(mockCreateLabel).toHaveBeenCalledWith('wallet-1', {
        name: 'Exchange',
        color: '#FF5733',
        description: 'Exchange transactions',
      });
    });

    it('should return 403 when user lacks edit access', async () => {
      mockCreateLabel.mockRejectedValue(new ForbiddenError('Edit access required'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/labels')
        .send({ name: 'Test' });

      expect(response.status).toBe(403);
    });

    it('should return 500 on internal error', async () => {
      mockCreateLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/labels')
        .send({ name: 'Test' });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /wallets/:walletId/labels/:labelId', () => {
    it('should update a label', async () => {
      const updatedLabel = { ...mockLabel, name: 'Updated Exchange' };
      mockUpdateLabel.mockResolvedValue(updatedLabel);

      const response = await request(app)
        .put('/api/v1/wallets/wallet-1/labels/label-1')
        .send({ name: 'Updated Exchange', color: '#00FF00' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Exchange');
      expect(mockUpdateLabel).toHaveBeenCalledWith('wallet-1', 'label-1', {
        name: 'Updated Exchange',
        color: '#00FF00',
        description: undefined,
      });
    });

    it('should return 404 when label not found', async () => {
      mockUpdateLabel.mockRejectedValue(new NotFoundError('Label not found'));

      const response = await request(app)
        .put('/api/v1/wallets/wallet-1/labels/nonexistent')
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockUpdateLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put('/api/v1/wallets/wallet-1/labels/label-1')
        .send({ name: 'Test' });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /wallets/:walletId/labels/:labelId', () => {
    it('should delete a label', async () => {
      mockDeleteLabel.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/labels/label-1');

      expect(response.status).toBe(204);
      expect(mockDeleteLabel).toHaveBeenCalledWith('wallet-1', 'label-1');
    });

    it('should return 404 when label not found', async () => {
      mockDeleteLabel.mockRejectedValue(new NotFoundError('Label not found'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/labels/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockDeleteLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/wallets/wallet-1/labels/label-1');

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // TRANSACTION LABEL OPERATIONS
  // ========================================

  describe('GET /transactions/:transactionId/labels', () => {
    it('should return labels for transaction', async () => {
      mockGetTransactionLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .get('/api/v1/transactions/tx-1/labels');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockGetTransactionLabels).toHaveBeenCalledWith('tx-1', 'user-1');
    });

    it('should return 404 when transaction not found', async () => {
      mockGetTransactionLabels.mockRejectedValue(new NotFoundError('Transaction not found'));

      const response = await request(app)
        .get('/api/v1/transactions/nonexistent/labels');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockGetTransactionLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/transactions/tx-1/labels');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /transactions/:transactionId/labels', () => {
    it('should add labels to transaction', async () => {
      mockAddTransactionLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .post('/api/v1/transactions/tx-1/labels')
        .send({ labelIds: ['label-1', 'label-2'] });

      expect(response.status).toBe(200);
      expect(mockAddTransactionLabels).toHaveBeenCalledWith('tx-1', 'user-1', ['label-1', 'label-2']);
    });

    it('should return 403 when user lacks edit access', async () => {
      mockAddTransactionLabels.mockRejectedValue(new ForbiddenError('Edit access required'));

      const response = await request(app)
        .post('/api/v1/transactions/tx-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(403);
    });

    it('should return 500 on internal error', async () => {
      mockAddTransactionLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/transactions/tx-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /transactions/:transactionId/labels', () => {
    it('should replace labels on transaction', async () => {
      mockReplaceTransactionLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .put('/api/v1/transactions/tx-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(200);
      expect(mockReplaceTransactionLabels).toHaveBeenCalledWith('tx-1', 'user-1', ['label-1']);
    });

    it('should return 404 when transaction is not found', async () => {
      mockReplaceTransactionLabels.mockRejectedValue(new NotFoundError('Transaction not found'));

      const response = await request(app)
        .put('/api/v1/transactions/nonexistent/labels')
        .send({ labelIds: [] });

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockReplaceTransactionLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put('/api/v1/transactions/tx-1/labels')
        .send({ labelIds: [] });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /transactions/:transactionId/labels/:labelId', () => {
    it('should remove label from transaction', async () => {
      mockRemoveTransactionLabel.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/transactions/tx-1/labels/label-1');

      expect(response.status).toBe(204);
      expect(mockRemoveTransactionLabel).toHaveBeenCalledWith('tx-1', 'label-1', 'user-1');
    });

    it('should return 404 when label not found', async () => {
      mockRemoveTransactionLabel.mockRejectedValue(new NotFoundError('Label not found'));

      const response = await request(app)
        .delete('/api/v1/transactions/tx-1/labels/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockRemoveTransactionLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/transactions/tx-1/labels/label-1');

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // ADDRESS LABEL OPERATIONS
  // ========================================

  describe('GET /addresses/:addressId/labels', () => {
    it('should return labels for address', async () => {
      mockGetAddressLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .get('/api/v1/addresses/addr-1/labels');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockGetAddressLabels).toHaveBeenCalledWith('addr-1', 'user-1');
    });

    it('should return 404 when address not found', async () => {
      mockGetAddressLabels.mockRejectedValue(new NotFoundError('Address not found'));

      const response = await request(app)
        .get('/api/v1/addresses/nonexistent/labels');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockGetAddressLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/addresses/addr-1/labels');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /addresses/:addressId/labels', () => {
    it('should add labels to address', async () => {
      mockAddAddressLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .post('/api/v1/addresses/addr-1/labels')
        .send({ labelIds: ['label-1', 'label-2'] });

      expect(response.status).toBe(200);
      expect(mockAddAddressLabels).toHaveBeenCalledWith('addr-1', 'user-1', ['label-1', 'label-2']);
    });

    it('should return 403 when user lacks edit access', async () => {
      mockAddAddressLabels.mockRejectedValue(new ForbiddenError('Edit access required'));

      const response = await request(app)
        .post('/api/v1/addresses/addr-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(403);
    });

    it('should return 500 on internal error', async () => {
      mockAddAddressLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/addresses/addr-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /addresses/:addressId/labels', () => {
    it('should replace labels on address', async () => {
      mockReplaceAddressLabels.mockResolvedValue([mockLabel]);

      const response = await request(app)
        .put('/api/v1/addresses/addr-1/labels')
        .send({ labelIds: ['label-1'] });

      expect(response.status).toBe(200);
      expect(mockReplaceAddressLabels).toHaveBeenCalledWith('addr-1', 'user-1', ['label-1']);
    });

    it('should return 404 when address is not found', async () => {
      mockReplaceAddressLabels.mockRejectedValue(new NotFoundError('Address not found'));

      const response = await request(app)
        .put('/api/v1/addresses/nonexistent/labels')
        .send({ labelIds: [] });

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockReplaceAddressLabels.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put('/api/v1/addresses/addr-1/labels')
        .send({ labelIds: [] });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /addresses/:addressId/labels/:labelId', () => {
    it('should remove label from address', async () => {
      mockRemoveAddressLabel.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/addresses/addr-1/labels/label-1');

      expect(response.status).toBe(204);
      expect(mockRemoveAddressLabel).toHaveBeenCalledWith('addr-1', 'label-1', 'user-1');
    });

    it('should return 404 when label not found', async () => {
      mockRemoveAddressLabel.mockRejectedValue(new NotFoundError('Label not found'));

      const response = await request(app)
        .delete('/api/v1/addresses/addr-1/labels/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 500 on internal error', async () => {
      mockRemoveAddressLabel.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/addresses/addr-1/labels/label-1');

      expect(response.status).toBe(500);
    });
  });
});

/**
 * Policy Evaluation Engine Tests
 *
 * Comprehensive tests for policy evaluation logic covering spending limits,
 * address controls, approval requirements, velocity limits, time delays,
 * monitor mode, preview mode, error handling, and usage recording.
 *
 * Target: 100% line/branch/statement/function coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo, mockWalletRepo, mockVaultPolicyService } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findOrCreateUsageWindow: vi.fn(),
    incrementUsageWindow: vi.fn().mockResolvedValue(undefined),
    findPolicyAddresses: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
  },
  mockWalletRepo: {
    findById: vi.fn(),
  },
  mockVaultPolicyService: {
    getActivePoliciesForWallet: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: mockWalletRepo,
}));

vi.mock('../../../src/services/vaultPolicy/vaultPolicyService', () => ({
  vaultPolicyService: mockVaultPolicyService,
}));

import { policyEvaluationEngine } from '../../../src/services/vaultPolicy/policyEvaluationEngine';

// Helper to build a full VaultPolicy-shaped object
function makePolicy(overrides: Record<string, unknown>) {
  return {
    id: faker.string.uuid(),
    name: 'Test Policy',
    type: 'spending_limit',
    config: {},
    enforcement: 'enforce',
    enabled: true,
    priority: 0,
    sourceType: 'wallet',
    walletId: faker.string.uuid(),
    groupId: null,
    createdBy: faker.string.uuid(),
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    description: null,
    ...overrides,
  };
}

describe('PolicyEvaluationEngine', () => {
  const walletId = faker.string.uuid();
  const userId = faker.string.uuid();
  const groupId = faker.string.uuid();
  const recipient = 'bc1qtest123456789';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId: null });
  });

  // ========================================
  // evaluatePolicies
  // ========================================

  describe('evaluatePolicies', () => {
    describe('no policies', () => {
      it('returns allowed when no policies exist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(result.limits).toBeUndefined();
      });
    });

    describe('wallet with groupId', () => {
      it('passes groupId from wallet to getActivePoliciesForWallet', async () => {
        mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId });
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, groupId);
      });

      it('passes null groupId when wallet has no group', async () => {
        mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId: null });
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
      });

      it('passes null groupId when wallet is not found', async () => {
        mockWalletRepo.findById.mockResolvedValue(null);
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
      });
    });

    // ========================================
    // spending_limit
    // ========================================

    describe('spending_limit', () => {
      it('blocks when per-transaction limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Tx Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 1_000_000, scope: 'wallet' },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('blocked');
        expect(result.triggered[0].type).toBe('spending_limit');
        expect(result.triggered[0].reason).toContain('per-transaction limit');
        expect(result.limits?.perTransaction).toEqual({ limit: 1_000_000 });
      });

      it('allows when under per-transaction limit and populates limit info', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Tx Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 1_000_000, scope: 'wallet' },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(result.limits?.perTransaction).toEqual({ limit: 1_000_000 });
      });

      it('blocks when daily limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 5_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(4_500_000),
          txCount: 3,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('daily');
        expect(result.limits?.daily).toBeDefined();
      });

      it('allows when daily limit has room and populates limit info', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 5_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(1_000_000),
          txCount: 1,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.daily).toEqual({
          used: 1_000_000,
          limit: 5_000_000,
          remaining: 4_000_000,
        });
      });

      it('blocks when weekly limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { weekly: 10_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(9_500_000),
          txCount: 5,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('weekly');
        expect(result.limits?.weekly).toBeDefined();
        expect(result.limits?.weekly?.remaining).toBe(500_000);
      });

      it('allows when weekly limit has room', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { weekly: 10_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(2_000_000),
          txCount: 2,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.weekly).toEqual({
          used: 2_000_000,
          limit: 10_000_000,
          remaining: 8_000_000,
        });
      });

      it('blocks when monthly limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monthly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { monthly: 50_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(49_500_000),
          txCount: 10,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('monthly');
        expect(result.limits?.monthly).toBeDefined();
      });

      it('allows when monthly limit has room', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monthly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { monthly: 50_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(5_000_000),
          txCount: 2,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.monthly).toEqual({
          used: 5_000_000,
          limit: 50_000_000,
          remaining: 45_000_000,
        });
      });

      it('checks all window types (daily, weekly, monthly) and returns combined limits', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Full Limits',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: {
              perTransaction: 5_000_000,
              daily: 10_000_000,
              weekly: 50_000_000,
              monthly: 100_000_000,
              scope: 'wallet',
            },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(1_000_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.perTransaction).toEqual({ limit: 5_000_000 });
        expect(result.limits?.daily).toBeDefined();
        expect(result.limits?.weekly).toBeDefined();
        expect(result.limits?.monthly).toBeDefined();
        // findOrCreateUsageWindow called 3 times (daily, weekly, monthly)
        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      });

      it('uses per_user scope when configured for spending_limit evaluation', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Per-User Daily',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'per_user' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId }),
        );
      });

      it('uses undefined userId for wallet scope', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Wallet Scope Daily',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId: undefined }),
        );
      });

      it('returns limits with remaining clamped to 0 when overspent', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        // totalSpent already exceeds limit
        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(1_500_000),
          txCount: 3,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.limits?.daily?.remaining).toBe(0);
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Limit',
            type: 'spending_limit',
            enforcement: 'monitor',
            config: { perTransaction: 100, scope: 'wallet' },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });

      it('returns limits undefined when no limit info is populated', async () => {
        // A policy that produces no limits (e.g., address_control) should not
        // have limits in the result. But spending_limit always populates limits.
        // Let's test the case where limits object has zero keys.
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Addr Control',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.limits).toBeUndefined();
      });
    });

    // ========================================
    // approval_required
    // ========================================

    describe('approval_required', () => {
      it('triggers when always is set', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 2,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 48,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true); // approval_required doesn't block
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('approval_required');
        expect(result.triggered[0].type).toBe('approval_required');
        expect(result.triggered[0].reason).toContain('2 approval(s)');
      });

      it('triggers when amount exceeds threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('approval_required');
        expect(result.triggered[0].reason).toContain('approval threshold');
      });

      it('does not trigger when amount is under threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.triggered).toHaveLength(0);
        expect(result.allowed).toBe(true);
      });

      it('does not trigger when neither always nor amountAbove triggers', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Unknown Only',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { unknownAddressesOnly: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.triggered).toHaveLength(0);
      });

      it('sets action to monitored in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Approval',
            type: 'approval_required',
            enforcement: 'monitor',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });

    // ========================================
    // address_control
    // ========================================

    describe('address_control', () => {
      it('blocks address not on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
          { address: 'bc1qallowed2', listType: 'allow' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qnotallowed',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('not on the allowlist');
      });

      it('allows address on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('allows empty allowlist (no restrictions)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Empty Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qanything',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('blocks address on denylist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qbadactor',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('denylist');
      });

      it('allows address not on denylist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qgoodactor',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('checks multiple outputs against allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qallowed1', amount: 50 },
            { address: 'bc1qnotallowed', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('not on the allowlist');
      });

      it('allows all outputs when all on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
          { address: 'bc1qallowed2', listType: 'allow' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qallowed1', amount: 50 },
            { address: 'bc1qallowed2', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('checks multiple outputs against denylist and blocks if any match', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qgoodactor',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qgoodactor', amount: 50 },
            { address: 'bc1qbadactor', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('denylist');
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Allowlist',
            type: 'address_control',
            enforcement: 'monitor',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qnotallowed',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });

    // ========================================
    // velocity
    // ========================================

    describe('velocity', () => {
      it('blocks when hourly tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Hourly Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerHour: 3, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 3,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('hourly');
        expect(result.triggered[0].type).toBe('velocity');
      });

      it('blocks when daily tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Tx Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 5, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 5,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('daily');
      });

      it('blocks when weekly tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Tx Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerWeek: 10, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 10,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('weekly');
      });

      it('allows when under all velocity limits', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Multi Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerHour: 5, maxPerDay: 20, maxPerWeek: 100, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 2,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        // 3 window checks: hourly, daily, weekly
        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      });

      it('uses per_user scope when configured', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Per-User Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 5, scope: 'per_user' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId }),
        );
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Velocity',
            type: 'velocity',
            enforcement: 'monitor',
            config: { maxPerDay: 1, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 5,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });

    // ========================================
    // time_delay
    // ========================================

    describe('time_delay', () => {
      it('triggers when always is set', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Cooling Period',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              delayHours: 24,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('time_delay');
        expect(result.triggered[0].action).toBe('approval_required');
        expect(result.triggered[0].reason).toContain('cooling period');
      });

      it('triggers when amountAbove threshold exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('time_delay');
        expect(result.triggered[0].action).toBe('approval_required');
      });

      it('does not trigger when amount is under amountAbove threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.triggered).toHaveLength(0);
      });

      it('does not trigger when trigger has no always or amountAbove', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Empty Trigger',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: {},
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.triggered).toHaveLength(0);
      });

      it('sets action to monitored in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Delay',
            type: 'time_delay',
            enforcement: 'monitor',
            config: {
              trigger: { always: true },
              delayHours: 24,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });

    // ========================================
    // Error handling
    // ========================================

    describe('error handling', () => {
      it('enforce-mode policy error blocks transaction (fail-closed)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Bad Policy',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: null, // Will cause evaluation error
          }),
          makePolicy({
            id: 'p2',
            name: 'Good Policy',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // First policy errored → blocked (fail-closed), second still evaluated
        expect(result.allowed).toBe(false);
        expect(result.triggered.some(t => t.reason.includes('precaution'))).toBe(true);
        expect(result.triggered.some(t => t.action === 'blocked')).toBe(true);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it('monitor-mode policy error does not block (fail-open)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Bad',
            type: 'spending_limit',
            enforcement: 'monitor',
            config: null, // Will cause evaluation error
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // Monitor mode → fail-open
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it('logs error message from Error instances', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Error Policy',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: null,
          }),
        ]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockLog.error).toHaveBeenCalledWith(
          'Policy evaluation error',
          expect.objectContaining({
            policyId: 'p1',
            policyType: 'spending_limit',
          }),
        );
      });

      it('logs non-Error exception as string in evaluation catch block', async () => {
        // Use a spending_limit policy with a valid config but make
        // findOrCreateUsageWindow reject with a non-Error value to hit the
        // String(error) branch in the catch block at line 167.
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'String Throw',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue('non-error string thrown');

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(mockLog.error).toHaveBeenCalledWith(
          'Policy evaluation error',
          expect.objectContaining({
            policyId: 'p1',
            error: 'non-error string thrown',
          }),
        );
      });
    });

    // ========================================
    // Preview mode
    // ========================================

    describe('preview mode', () => {
      it('skips event logging in preview mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
          preview: true,
        });

        expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
      });

      it('logs events when not in preview mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            policyId: 'p1',
            walletId,
            userId,
            eventType: 'triggered',
            details: expect.objectContaining({
              action: 'approval_required',
              amount: '100',
              recipient,
            }),
          }),
        );
      });

      it('uses evaluated event type for monitored actions', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Approval',
            type: 'approval_required',
            enforcement: 'monitor',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'evaluated', // monitored → 'evaluated'
          }),
        );
      });

      it('handles createPolicyEvent failure gracefully', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        mockPolicyRepo.createPolicyEvent.mockRejectedValue(new Error('DB event write failed'));

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // The evaluation result should still be correct despite event logging failure
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);

        // Wait for the catch handler to fire
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to log policy event',
          expect.objectContaining({ error: 'DB event write failed' }),
        );
      });

      it('handles createPolicyEvent failure with non-Error value', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        mockPolicyRepo.createPolicyEvent.mockRejectedValue('string error');

        await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to log policy event',
          expect.objectContaining({ error: 'string error' }),
        );
      });
    });

    // ========================================
    // Multiple policies
    // ========================================

    describe('multiple policies', () => {
      it('evaluates all policies and combines results', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Spending Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 10_000_000, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 5_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(7_000_000),
        });

        // Under spending limit but above approval threshold
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('approval_required');
      });

      it('blocks when any enforce-mode policy blocks', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Low Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 100, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(2);
      });

      it('evaluates all policy types together', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Spending',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 10_000_000, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
          makePolicy({
            id: 'p3',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
          makePolicy({
            id: 'p4',
            name: 'Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 100, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p5',
            name: 'Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);
        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        const result = await policyEvaluationEngine.evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        // approval_required + time_delay triggered (empty allowlist doesn't block)
        expect(result.triggered).toHaveLength(2);
        expect(result.triggered.map(t => t.type)).toContain('approval_required');
        expect(result.triggered.map(t => t.type)).toContain('time_delay');
      });
    });
  });

  // ========================================
  // recordUsage
  // ========================================

  describe('recordUsage', () => {
    it('records spending_limit daily usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Daily Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          walletId,
          windowType: 'daily',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records spending_limit weekly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { weekly: 20_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'weekly',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records spending_limit monthly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Monthly Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'monthly',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records all spending_limit windows (daily, weekly, monthly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Full Limits',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, weekly: 20_000_000, monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledTimes(3);

      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType
      );
      expect(windowTypes).toContain('daily');
      expect(windowTypes).toContain('weekly');
      expect(windowTypes).toContain('monthly');
    });

    it('records velocity hourly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Hourly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'hourly',
        }),
      );
      // Velocity increments with BigInt(0) for amount (only counting tx)
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records velocity daily usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Daily Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ windowType: 'daily' }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records velocity weekly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerWeek: 50, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ windowType: 'weekly' }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records all velocity windows (hourly, daily, weekly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Multi Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 5, maxPerDay: 20, maxPerWeek: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledTimes(3);

      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType
      );
      expect(windowTypes).toContain('hourly');
      expect(windowTypes).toContain('daily');
      expect(windowTypes).toContain('weekly');
    });

    it('uses per_user scope when spending_limit configured', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Per-User Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'per_user' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
    });

    it('uses per_user scope when velocity configured', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Per-User Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'per_user' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
    });

    it('uses undefined userId for wallet scope on spending_limit', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Wallet Scope',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('uses undefined userId for wallet scope on velocity', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Wallet Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('skips non-spending/velocity policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Approval',
          type: 'approval_required',
          enforcement: 'enforce',
          config: {
            trigger: { always: true },
            requiredApprovals: 1,
            quorumType: 'any_n',
            allowSelfApproval: false,
            expirationHours: 24,
          },
        }),
        makePolicy({
          id: 'p2',
          name: 'Addr Control',
          type: 'address_control',
          enforcement: 'enforce',
          config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
        }),
        makePolicy({
          id: 'p3',
          name: 'Delay',
          type: 'time_delay',
          enforcement: 'enforce',
          config: {
            trigger: { always: true },
            delayHours: 12,
            vetoEligible: 'any_approver',
            notifyOnStart: true,
            notifyOnVeto: true,
            notifyOnClear: true,
          },
        }),
      ]);

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
      expect(mockPolicyRepo.incrementUsageWindow).not.toHaveBeenCalled();
    });

    it('skips spending_limit with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Zero Limits',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 0, weekly: 0, monthly: 0, scope: 'wallet' },
        }),
      ]);

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
    });

    it('skips velocity with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Zero Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 0, maxPerDay: 0, maxPerWeek: 0, scope: 'wallet' },
        }),
      ]);

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without throwing', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Erroring',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100))
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to record policy usage',
        expect.objectContaining({
          policyId: 'p1',
          error: 'DB down',
        }),
      );
    });

    it('handles non-Error exceptions gracefully', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Erroring',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue('string error');

      await expect(
        policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100))
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to record policy usage',
        expect.objectContaining({
          error: 'string error',
        }),
      );
    });

    it('passes groupId from wallet when recording usage', async () => {
      mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId });
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, groupId);
    });

    it('passes null groupId when wallet not found during recordUsage', async () => {
      mockWalletRepo.findById.mockResolvedValue(null);
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
    });

    it('records both spending_limit and velocity for multiple policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Spending Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p2',
          name: 'Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p3',
          name: 'Approval',
          type: 'approval_required',
          enforcement: 'enforce',
          config: {
            trigger: { always: true },
            requiredApprovals: 1,
            quorumType: 'any_n',
            allowSelfApproval: false,
            expirationHours: 24,
          },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      // spending_limit daily + velocity daily = 2 calls
      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(2);
      // spending_limit gets actual amount, velocity gets BigInt(0)
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });
  });

  // ========================================
  // getWindowBounds (tested indirectly)
  // ========================================

  describe('getWindowBounds (via evaluateVelocity and evaluateSpendingLimit)', () => {
    it('exercises hourly window bounds via velocity evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Hourly Check',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('hourly');
      // Verify window bounds are Date objects
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // End should be after start
      expect(call.windowEnd.getTime()).toBeGreaterThan(call.windowStart.getTime());
      // Hourly: end - start should be exactly 1 hour (3600000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(3_600_000);
    });

    it('exercises daily window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Daily Check',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('daily');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Daily: end - start should be exactly 1 day (86400000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(86_400_000);
    });

    it('exercises weekly window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Check',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { weekly: 20_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('weekly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Weekly: end - start should be exactly 7 days (604800000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(604_800_000);
    });

    it('exercises monthly window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Monthly Check',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('monthly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Monthly window: start should be first of month
      expect(call.windowStart.getDate()).toBe(1);
      // End should be first of next month
      expect(call.windowEnd.getDate()).toBe(1);
      expect(call.windowEnd.getMonth()).toBe((call.windowStart.getMonth() + 1) % 12);
    });

    it('exercises hourly window bounds via recordUsage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Hourly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('hourly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(3_600_000);
    });

    it('exercises weekly window bounds via recordUsage (velocity)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerWeek: 50, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('weekly');
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(604_800_000);
    });

    it('exercises monthly window bounds via recordUsage (spending_limit)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Monthly Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('monthly');
      expect(call.windowStart.getDate()).toBe(1);
    });
  });
});

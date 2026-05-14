/**
 * PHASE D — non-regression tests for audit 2026-05-12
 *
 * CI WIRING: This file is included in the `quick-backend-integration-smoke`
 * job's vitest file list in `.github/workflows/test.yml`. It runs whenever
 * `backend_integration_changed` is true (which fires on changes under
 * `server/tests/integration/*` or `server/src/api/*` — see
 * `scripts/ci/classify-files-lib.sh::is_backend_integration_file`). On host,
 * the file skips silently when `DATABASE_URL` is unset; in CI the Postgres
 * service container is provisioned by the smoke job and the test runs for real.
 *
 * These tests pin the fixed behavior: every nested approval identifier must
 * belong to the wallet and draft named in the route before the route calls
 * approval services.
 *
 * Two accepted CRITICAL findings on the wallet-approval routes:
 *
 *   1. server/src/api/wallets/approvals.ts:59
 *      Vote endpoint takes :requestId from the route but never verifies the
 *      request belongs to the route :walletId / :draftId. An approver on
 *      wallet A can vote on wallet B's approval request by passing wallet B's
 *      request ID into wallet A's route.
 *
 *   2. server/src/api/wallets/approvals.ts:102
 *      Owner override accepts :draftId unscoped — an owner on wallet A can
 *      force-approve a draft belonging to wallet B if they know the draft ID.
 *
 * Both findings share the same shape: the route authorizes only :walletId,
 * then forwards the sibling identifier to the service unchecked.
 *
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { authHeader, createAndLoginUser, createTestUser, loginTestUser } from '../setup/helpers';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '../../../src/generated/prisma/client';

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Wallet Approvals — audit 2026-05-12 cross-wallet IDOR', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    vi.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: vi.fn().mockResolvedValue({
        connect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: vi.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: vi.fn().mockResolvedValue([]),
      }),
    }));

    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  // ---------------------------------------------------------------------------
  // Shared fixtures
  // ---------------------------------------------------------------------------

  /**
   * Build two independent wallets with their own policies and pending approval
   * requests. The voter is an approver on wallet A only; the second user owns
   * wallet B and is therefore wallet B's draft author.
   */
  async function buildTwoWalletApprovalScenario(): Promise<{
    voterId: string;
    voterToken: string;
    walletA: { id: string; draftId: string };
    walletB: { id: string; draftId: string; requestId: string };
  }> {
    const { userId: voterId, token: voterToken } = await createAndLoginUser(app, prisma);
    const bOwner = await createTestUser(prisma, {
      username: `b_owner_${Date.now()}`,
      password: 'TestPassword123!',
    });
    // Login so the user has a known session (not actually used for the IDOR
    // assertion, but mirrors realistic two-user data).
    await loginTestUser(app, { username: bOwner.username, password: 'TestPassword123!' });

    const walletA = await prisma.wallet.create({
      data: {
        name: 'Wallet A',
        type: 'single_sig',
        scriptType: 'native_segwit',
        users: { create: { userId: voterId, role: 'approver' } },
      },
    });

    const walletB = await prisma.wallet.create({
      data: {
        name: 'Wallet B',
        type: 'single_sig',
        scriptType: 'native_segwit',
        users: { create: { userId: bOwner.id, role: 'owner' } },
      },
    });

    const draftA = await prisma.draftTransaction.create({
      data: {
        walletId: walletA.id,
        userId: voterId,
        recipient: 'tb1qexampleexampleexampleexampleexample',
        amount: 1000n,
        feeRate: 1,
        selectedUtxoIds: [],
        psbtBase64: 'cHNidP8=',
        fee: 100n,
        totalInput: 1100n,
        totalOutput: 1000n,
        changeAmount: 0n,
        effectiveAmount: 1000n,
        inputPaths: [],
      },
    });

    const draftB = await prisma.draftTransaction.create({
      data: {
        walletId: walletB.id,
        userId: bOwner.id,
        recipient: 'tb1qexampleexampleexampleexampleexample',
        amount: 5000n,
        feeRate: 1,
        selectedUtxoIds: [],
        psbtBase64: 'cHNidP8=',
        fee: 100n,
        totalInput: 5100n,
        totalOutput: 5000n,
        changeAmount: 0n,
        effectiveAmount: 5000n,
        inputPaths: [],
        approvalStatus: 'pending',
      },
    });

    const policyB = await prisma.vaultPolicy.create({
      data: {
        walletId: walletB.id,
        name: 'Wallet B approval policy',
        type: 'approval_required',
        config: { requiredApprovals: 1, quorumType: 'any_n' },
        createdBy: bOwner.id,
      },
    });

    const requestB = await prisma.approvalRequest.create({
      data: {
        draftTransactionId: draftB.id,
        policyId: policyB.id,
        status: 'pending',
        requiredApprovals: 1,
        quorumType: 'any_n',
      },
    });

    return {
      voterId,
      voterToken,
      walletA: { id: walletA.id, draftId: draftA.id },
      walletB: { id: walletB.id, draftId: draftB.id, requestId: requestB.id },
    };
  }

  // ---------------------------------------------------------------------------
  // Finding 1: approval vote requestId not scoped to walletId
  // ---------------------------------------------------------------------------

  // PHASE D — non-regression test for audit 2026-05-12
  // Finding: server/src/api/wallets/approvals.ts:59
  //   The vote route authorizes `approve` access on :walletId but forwards
  //   :requestId straight into approvalService.castVote() without checking
  //   that the request lives under the route's wallet/draft.
  test(
    'POST /:walletId/.../approvals/:requestId/vote rejects when requestId belongs to a different wallet',
    async () => {
      const scenario = await buildTwoWalletApprovalScenario();

      const response = await request(app)
        .post(
          `/api/v1/wallets/${scenario.walletA.id}/drafts/${scenario.walletA.draftId}` +
            `/approvals/${scenario.walletB.requestId}/vote`,
        )
        .set(authHeader(scenario.voterToken))
        .send({ decision: 'approve' });

      // Post-fix: this MUST be a 4xx (most likely 403 or 404). Anything 2xx
      // means the voter on wallet A successfully voted on wallet B's request.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      // Defense in depth: no vote row should exist for this user/request pair.
      const persistedVote = await prisma.approvalVote.findFirst({
        where: { approvalRequestId: scenario.walletB.requestId, userId: scenario.voterId },
      });
      expect(persistedVote).toBeNull();
    },
  );

  // ---------------------------------------------------------------------------
  // Finding 2: owner override draftId not scoped to walletId
  // ---------------------------------------------------------------------------

  // PHASE D — non-regression test for audit 2026-05-12
  // Finding: server/src/api/wallets/approvals.ts:102
  //   The override route authorizes `owner` on :walletId but forwards :draftId
  //   to approvalService.ownerOverride() without verifying the draft belongs
  //   to that wallet. Owner of wallet A can force-approve wallet B's draft.
  test(
    'POST /:walletId/drafts/:draftId/override rejects when draftId belongs to a different wallet',
    async () => {
      const scenario = await buildTwoWalletApprovalScenario();

      // Promote the voter to owner of wallet A so the requireWalletAccess('owner')
      // gate passes for the route. The IDOR is in the draftId, not the role.
      await prisma.walletUser.updateMany({
        where: { walletId: scenario.walletA.id, userId: scenario.voterId },
        data: { role: 'owner' },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${scenario.walletA.id}/drafts/${scenario.walletB.draftId}/override`)
        .set(authHeader(scenario.voterToken))
        .send({ reason: 'audit-test-cross-wallet-override' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      // Wallet B's draft must remain in its original pending state — the
      // override is the financially dangerous side effect we are blocking.
      const draftB = await prisma.draftTransaction.findUnique({
        where: { id: scenario.walletB.draftId },
        select: { approvalStatus: true },
      });
      expect(draftB?.approvalStatus).toBe('pending');
    },
  );

  test(
    'GET /:walletId/drafts/:draftId/approvals rejects when draftId belongs to a different wallet',
    async () => {
      const scenario = await buildTwoWalletApprovalScenario();

      const response = await request(app)
        .get(`/api/v1/wallets/${scenario.walletA.id}/drafts/${scenario.walletB.draftId}/approvals`)
        .set(authHeader(scenario.voterToken));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    },
  );
});

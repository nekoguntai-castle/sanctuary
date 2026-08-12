import { describe, expect, it } from 'vitest';
import {
  mockApproveWalletRemediationProposal,
  mockAuditLogFromRequest,
  mockCancelWalletRemediationProposal,
  mockCreateWalletRemediationProposal,
  mockExportWalletRemediationProposal,
  request,
  walletRouter,
} from './walletsTestHarness';

const digest = 'a'.repeat(64);
const proposalId = `wallet-remediation-v1:${digest}`;
const proposal = {
  schemaVersion: 'sanctuary.wallet-remediation.v1',
  proposalId,
  proposalDigest: digest,
  walletId: 'wallet-123',
  createdAt: '2026-08-11T00:00:00.000Z',
  state: 'pending',
  eligible: true,
  originalStateDigest: 'b'.repeat(64),
  changes: [],
  blockers: [],
  proof: {
    preservedPolicyDigest: 'c'.repeat(64), addressCount: 1, unchangedAddressCount: 1,
    scriptPubKeyCount: 1, unchangedScriptPubKeyCount: 1,
    recoveryStatus: 'recovery-proven', signingStatus: 'not-tested', recoveryEvidenceDigest: 'e'.repeat(64), evidenceIds: ['evidence-1'],
  },
  backout: { state: 'not-applied', message: 'No active metadata has changed.' },
};

export const registerWalletRemediationContracts = () => {
  describe('wallet remediation routes', () => {
    it('creates an owner-scoped immutable preview with an exact empty body', async () => {
      mockCreateWalletRemediationProposal.mockResolvedValue(proposal);
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/remediation/proposals')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body).toEqual(proposal);
      expect(mockCreateWalletRemediationProposal).toHaveBeenCalledWith(
        'wallet-123', { userId: 'test-user-id', username: 'testuser' },
      );
      expect(mockAuditLogFromRequest).toHaveBeenCalled();
    });

    it('approves and cancels only an exact proposal ID and digest', async () => {
      mockApproveWalletRemediationProposal.mockResolvedValue({ ...proposal, state: 'applied' });
      const approve = await request(walletRouter)
        .post(`/api/v1/wallets/wallet-123/remediation/proposals/${proposalId}/approve`)
        .send({ proposalDigest: digest });
      expect(approve.status).toBe(200);
      expect(mockApproveWalletRemediationProposal).toHaveBeenCalledWith(
        'wallet-123', proposalId, digest, { userId: 'test-user-id', username: 'testuser' },
      );

      mockCancelWalletRemediationProposal.mockResolvedValue({ ...proposal, state: 'cancelled' });
      const cancel = await request(walletRouter)
        .post(`/api/v1/wallets/wallet-123/remediation/proposals/${proposalId}/cancel`)
        .send({ proposalDigest: digest });
      expect(cancel.status).toBe(200);
      expect(mockCancelWalletRemediationProposal).toHaveBeenCalledWith(
        'wallet-123', proposalId, digest, { userId: 'test-user-id', username: 'testuser' },
      );

      const malformed = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/remediation/proposals/latest/approve')
        .send({ proposalDigest: digest });
      expect(malformed.status).toBe(400);
    });

    it('exports only exact evidence with no-store and attachment headers', async () => {
      const evidence = { proposal, events: [] };
      mockExportWalletRemediationProposal.mockResolvedValue(evidence);
      const response = await request(walletRouter)
        .get(`/api/v1/wallets/wallet-123/remediation/proposals/${proposalId}/export?digest=${digest}`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toContain(proposalId);
      expect(response.body).toEqual(evidence);
      expect(mockExportWalletRemediationProposal).toHaveBeenCalledWith(
        'wallet-123', proposalId, digest,
      );
    });
  });
};

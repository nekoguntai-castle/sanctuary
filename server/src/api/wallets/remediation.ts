import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../errors/errorHandler';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import {
  approveWalletRemediationProposal,
  cancelWalletRemediationProposal,
  createWalletRemediationProposal,
  exportWalletRemediationProposal,
} from '../../services/walletRemediation';

const router = Router();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const proposalIdSchema = z.string().regex(/^wallet-remediation-v1:[0-9a-f]{64}$/);
const emptyBodySchema = z.object({}).strict();
const approvalBodySchema = z.object({ proposalDigest: digestSchema }).strict();
const exportQuerySchema = z.object({ digest: digestSchema }).strict();
const proposalParamsSchema = z.object({
  id: z.string().min(1),
  proposalId: proposalIdSchema,
}).strict();

const actorFromRequest = (req: Request) => {
  const user = requireAuthenticatedUser(req);
  return { userId: user.userId, username: user.username };
};

router.post(
  '/:id/remediation/proposals',
  requireWalletAccess('owner'),
  validate({ body: emptyBodySchema }),
  asyncHandler(async (req, res) => {
    const actor = actorFromRequest(req);
    const proposal = await createWalletRemediationProposal(req.walletId!, actor);
    await auditService.logFromRequest(req, AuditAction.WALLET_REMEDIATION_PREVIEW, AuditCategory.WALLET, {
      details: {
        walletId: proposal.walletId,
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        eligible: proposal.eligible,
        changeCount: proposal.changes.length,
      },
    });
    res.status(201).json(proposal);
  }),
);

router.post(
  '/:id/remediation/proposals/:proposalId/cancel',
  requireWalletAccess('owner'),
  validate({ body: approvalBodySchema, params: proposalParamsSchema }),
  asyncHandler(async (req, res) => {
    const actor = actorFromRequest(req);
    const proposal = await cancelWalletRemediationProposal(
      req.walletId!, req.params.proposalId, req.body.proposalDigest, actor,
    );
    await auditService.logFromRequest(req, AuditAction.WALLET_REMEDIATION_CANCEL, AuditCategory.WALLET, {
      details: {
        walletId: proposal.walletId,
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
      },
    });
    res.json(proposal);
  }),
);

router.post(
  '/:id/remediation/proposals/:proposalId/approve',
  requireWalletAccess('owner'),
  validate({ body: approvalBodySchema, params: proposalParamsSchema }),
  asyncHandler(async (req, res) => {
    const actor = actorFromRequest(req);
    const proposal = await approveWalletRemediationProposal(
      req.walletId!, req.params.proposalId, req.body.proposalDigest, actor,
    );
    await auditService.logFromRequest(req, AuditAction.WALLET_REMEDIATION_APPROVE, AuditCategory.WALLET, {
      details: {
        walletId: proposal.walletId,
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        changeCount: proposal.changes.length,
        evidenceIds: proposal.proof.evidenceIds,
      },
    });
    res.json(proposal);
  }),
);

router.get(
  '/:id/remediation/proposals/:proposalId/export',
  requireWalletAccess('owner'),
  validate({ params: proposalParamsSchema, query: exportQuerySchema }),
  asyncHandler(async (req, res) => {
    const evidence = await exportWalletRemediationProposal(
      req.walletId!, req.params.proposalId, String(req.query.digest),
    );
    const { proposal } = evidence;
    await auditService.logFromRequest(req, AuditAction.WALLET_REMEDIATION_EXPORT, AuditCategory.WALLET, {
      details: {
        walletId: proposal.walletId,
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        state: proposal.state,
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${proposal.proposalId}.json"`);
    res.json(evidence);
  }),
);

export default router;

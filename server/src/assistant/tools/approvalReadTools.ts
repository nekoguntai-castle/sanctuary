import * as z from 'zod/v4';
import { WALLET_APPROVE_ROLE_VALUES } from '@sanctuary/shared/constants/walletRoles';
import { walletSharingRepository } from '../../repositories';
import { approvalService } from '../../services/vaultPolicy/approvalService';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const approvalBudget = { maxRows: 100, maxBytes: 96_000 };

const pendingApprovalsInputSchema = {} as const;

function toPendingApprovalDto(approval: Awaited<ReturnType<typeof approvalService.getPendingApprovalsForUser>>[number]) {
  return {
    id: approval.id,
    draftTransactionId: approval.draftTransactionId,
    walletId: approval.draftTransaction.walletId,
    status: approval.status,
    requiredApprovals: approval.requiredApprovals,
    currentApprovals: approval.votes.filter(vote => vote.decision === 'approve').length,
    totalVotes: approval.votes.length,
    amount: approval.draftTransaction.amount.toString(),
    expiresAt: approval.expiresAt,
    createdAt: approval.createdAt,
  };
}

function intersectWalletScope(
  walletIds: string[],
  walletScopeIds: string[] | undefined
): string[] {
  const uniqueWalletIds = [...new Set(walletIds)];
  if (walletScopeIds == null) {
    return uniqueWalletIds;
  }

  const walletScope = new Set(walletScopeIds);
  return uniqueWalletIds.filter((walletId) => walletScope.has(walletId));
}

export const pendingApprovalsTool: AssistantReadToolDefinition<typeof pendingApprovalsInputSchema> = {
  name: 'get_pending_approvals',
  title: 'Get Pending Approvals',
  description: 'List pending approval requests across wallets where the caller can approve',
  inputSchema: pendingApprovalsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet_set',
    description: 'Requires an explicit wallet-scoped session; results are limited to approve-capable wallets.',
  },
  budgets: approvalBudget,
  async execute(_input, context) {
    const approveWalletIds = intersectWalletScope(
      await walletSharingRepository.findWalletIdsByUserRole(
        context.actor.userId,
        [...WALLET_APPROVE_ROLE_VALUES]
      ),
      context.walletScopeIds
    );
    const approveWalletSet = new Set(approveWalletIds);
    const pending = approveWalletIds.length === 0
      ? []
      : await approvalService.getPendingApprovalsForUser(approveWalletIds);
    const approvals = pending
      .filter((approval) => approveWalletSet.has(approval.draftTransaction.walletId))
      .map(toPendingApprovalDto);

    return createToolEnvelope({
      tool: pendingApprovalsTool,
      context,
      data: {
        approvals,
        total: approvals.length,
      },
      summary: `Found ${approvals.length} pending approvals.`,
      facts: [
        { label: 'pending_approval_count', value: approvals.length },
        { label: 'approve_wallet_count', value: approveWalletIds.length },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'approval_requests' }],
      redactions: [
        'approval_recipient_addresses',
        'approval_vote_user_details',
      ],
      audit: { walletCount: approveWalletIds.length, rowCount: approvals.length },
    });
  },
};

export const approvalReadTools = [pendingApprovalsTool];

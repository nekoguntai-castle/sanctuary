/**
 * Mobile Agent Draft Service
 *
 * Mobile review foundation for agent-submitted funding drafts. This service
 * does not introduce an automatic approval path: human approval is represented
 * by either an audited review decision or a signed PSBT submitted through the
 * same draft update path used by web signing.
 */

import { draftRepository, type MobileAgentDraftRecord } from '../repositories';
import { draftService } from './draftService';
import { mobilePermissionService } from './mobilePermissions';
import { ForbiddenError, NotFoundError } from '../errors';
import type { DraftStatus } from '../repositories/draftRepository';
import type { MobileAction } from './mobilePermissions';

type MobilePermissionMap = Record<MobileAction, boolean>;

export interface MobileAgentDraftReview {
  id: string;
  walletId: string;
  wallet: {
    id: string;
    name: string;
    type: string;
    network: string;
  };
  agentId: string;
  agentOperationalWalletId: string | null;
  recipient: string;
  amountSats: string;
  feeSats: string;
  feeRate: number;
  status: string;
  approvalStatus: string;
  label: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  summary: {
    inputs: unknown;
    outputs: unknown;
    selectedUtxoIds: string[];
    totalInputSats: string;
    totalOutputSats: string;
    changeAmountSats: string;
    changeAddress: string | null;
    effectiveAmountSats: string;
    inputPaths: string[];
  };
  signing: {
    canSign: boolean;
    signedDeviceIds: string[];
    signatureEndpoint: string;
    signedPsbtUploadSupported: boolean;
    supportedSignerRequired: boolean;
  };
  review: {
    canApprove: boolean;
    canReject: boolean;
    canComment: boolean;
    approveEndpoint: string;
    rejectEndpoint: string;
    commentEndpoint: string;
  };
  deepLink: {
    scheme: string;
    webPath: string;
    apiPath: string;
    notificationPayload: {
      type: 'agent_funding_draft';
      walletId: string;
      draftId: string;
      agentId: string;
    };
  };
}

export interface MobileAgentDraftDecisionResponse {
  draft: MobileAgentDraftReview;
  decision: 'approve' | 'comment' | 'reject';
  comment: string | null;
  nextAction: 'sign' | 'none';
}

export interface MobileAgentDraftSignatureInput {
  signedPsbtBase64: string;
  signedDeviceId: string;
  status?: DraftStatus;
}

interface ReviewContext {
  draft: MobileAgentDraftRecord;
  permissions: MobilePermissionMap;
  review: MobileAgentDraftReview;
}

function toSatsString(value: bigint | number): string {
  return value.toString();
}

function normalizeJson(value: unknown): unknown {
  return value ?? null;
}

function buildEndpoint(draftId: string, suffix = ''): string {
  return `/api/v1/mobile/agent-funding-drafts/${draftId}${suffix}`;
}

function canReview(permissions: MobilePermissionMap): boolean {
  return permissions.approveTransaction || permissions.signPsbt;
}

function buildReview(
  draft: MobileAgentDraftRecord,
  permissions: MobilePermissionMap
): MobileAgentDraftReview {
  const agentId = draft.agentId;
  if (!agentId) {
    throw new NotFoundError('Agent funding draft not found');
  }

  const canSign = permissions.signPsbt;
  const canApproveOrReject = canReview(permissions);

  return {
    id: draft.id,
    walletId: draft.walletId,
    wallet: {
      id: draft.wallet.id,
      name: draft.wallet.name,
      type: draft.wallet.type,
      network: draft.wallet.network,
    },
    agentId,
    agentOperationalWalletId: draft.agentOperationalWalletId,
    recipient: draft.recipient,
    amountSats: toSatsString(draft.amount),
    feeSats: toSatsString(draft.fee),
    feeRate: draft.feeRate,
    status: draft.status,
    approvalStatus: draft.approvalStatus,
    label: draft.label,
    memo: draft.memo,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    expiresAt: draft.expiresAt?.toISOString() ?? null,
    summary: {
      inputs: normalizeJson(draft.inputs),
      outputs: normalizeJson(draft.outputs),
      selectedUtxoIds: draft.selectedUtxoIds,
      totalInputSats: toSatsString(draft.totalInput),
      totalOutputSats: toSatsString(draft.totalOutput),
      changeAmountSats: toSatsString(draft.changeAmount),
      changeAddress: draft.changeAddress,
      effectiveAmountSats: toSatsString(draft.effectiveAmount),
      inputPaths: draft.inputPaths,
    },
    signing: {
      canSign,
      signedDeviceIds: draft.signedDeviceIds,
      signatureEndpoint: buildEndpoint(draft.id, '/signature'),
      signedPsbtUploadSupported: canSign,
      supportedSignerRequired: true,
    },
    review: {
      canApprove: canApproveOrReject,
      canReject: canApproveOrReject,
      canComment: canApproveOrReject,
      approveEndpoint: buildEndpoint(draft.id, '/approve'),
      rejectEndpoint: buildEndpoint(draft.id, '/reject'),
      commentEndpoint: buildEndpoint(draft.id, '/comment'),
    },
    deepLink: {
      scheme: `sanctuary://agent-funding-drafts/${draft.id}`,
      webPath: `/wallets/${draft.walletId}/drafts/${draft.id}?source=agent-funding`,
      apiPath: buildEndpoint(draft.id),
      notificationPayload: {
        type: 'agent_funding_draft',
        walletId: draft.walletId,
        draftId: draft.id,
        agentId,
      },
    },
  };
}

async function buildReviewContext(
  userId: string,
  draft: MobileAgentDraftRecord
): Promise<ReviewContext> {
  const effective = await mobilePermissionService.getEffectivePermissions(draft.walletId, userId);
  const permissions = effective.permissions;
  const review = buildReview(draft, permissions);
  return { draft, permissions, review };
}

function assertCanView(permissions: MobilePermissionMap): void {
  if (!permissions.viewTransactions) {
    throw new ForbiddenError('Mobile access denied for agent funding drafts');
  }
}

function assertCanReview(permissions: MobilePermissionMap): void {
  if (!canReview(permissions)) {
    throw new ForbiddenError('Mobile access denied for agent funding draft review');
  }
}

function assertCanSign(permissions: MobilePermissionMap): void {
  if (!permissions.signPsbt) {
    throw new ForbiddenError('Mobile access denied for agent funding draft signing');
  }
}

async function getPendingReviewContext(userId: string, draftId: string): Promise<ReviewContext> {
  const draft = await draftRepository.findPendingAgentDraftByIdForUser(userId, draftId);
  if (!draft) {
    throw new NotFoundError('Agent funding draft not found');
  }

  const context = await buildReviewContext(userId, draft);
  assertCanView(context.permissions);
  return context;
}

async function getReviewContext(userId: string, draftId: string): Promise<ReviewContext> {
  const draft = await draftRepository.findAgentDraftByIdForUser(userId, draftId);
  if (!draft) {
    throw new NotFoundError('Agent funding draft not found');
  }

  const context = await buildReviewContext(userId, draft);
  assertCanView(context.permissions);
  return context;
}

export async function listPendingAgentFundingDrafts(
  userId: string,
  limit: number
): Promise<MobileAgentDraftReview[]> {
  const drafts = await draftRepository.findPendingAgentDraftsForUser(userId, limit);
  const contexts = await Promise.all(
    drafts.map(async (draft) => {
      try {
        return await buildReviewContext(userId, draft);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return null;
        }
        throw error;
      }
    })
  );

  return contexts
    .filter((context): context is ReviewContext => context !== null && context.permissions.viewTransactions)
    .map((context) => context.review);
}

export async function getAgentFundingDraftForReview(
  userId: string,
  draftId: string
): Promise<MobileAgentDraftReview> {
  const context = await getPendingReviewContext(userId, draftId);
  return context.review;
}

export async function approveAgentFundingDraft(
  userId: string,
  draftId: string,
  comment?: string
): Promise<MobileAgentDraftDecisionResponse> {
  const context = await getPendingReviewContext(userId, draftId);
  assertCanReview(context.permissions);

  return {
    draft: context.review,
    decision: 'approve',
    comment: comment ?? null,
    nextAction: context.review.signing.canSign ? 'sign' : 'none',
  };
}

export async function commentOnAgentFundingDraft(
  userId: string,
  draftId: string,
  comment: string
): Promise<MobileAgentDraftDecisionResponse> {
  const context = await getPendingReviewContext(userId, draftId);
  assertCanReview(context.permissions);

  return {
    draft: context.review,
    decision: 'comment',
    comment,
    nextAction: context.review.signing.canSign ? 'sign' : 'none',
  };
}

export async function rejectAgentFundingDraft(
  userId: string,
  draftId: string,
  reason: string
): Promise<MobileAgentDraftDecisionResponse> {
  const context = await getPendingReviewContext(userId, draftId);
  assertCanReview(context.permissions);

  await draftRepository.updateApprovalStatus(draftId, 'rejected');
  const rejected = await getReviewContext(userId, draftId);

  return {
    draft: rejected.review,
    decision: 'reject',
    comment: reason,
    nextAction: 'none',
  };
}

export async function submitAgentFundingDraftSignature(
  userId: string,
  draftId: string,
  input: MobileAgentDraftSignatureInput
): Promise<MobileAgentDraftReview> {
  const context = await getPendingReviewContext(userId, draftId);
  assertCanSign(context.permissions);

  await draftService.updateDraft(context.draft.walletId, draftId, {
    signedPsbtBase64: input.signedPsbtBase64,
    signedDeviceId: input.signedDeviceId,
    status: input.status,
  });

  const updated = await getReviewContext(userId, draftId);
  return updated.review;
}

export const mobileAgentDraftService = {
  listPendingAgentFundingDrafts,
  getAgentFundingDraftForReview,
  approveAgentFundingDraft,
  commentOnAgentFundingDraft,
  rejectAgentFundingDraft,
  submitAgentFundingDraftSignature,
};

export default mobileAgentDraftService;

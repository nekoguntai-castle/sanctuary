import type { Prisma } from '../generated/prisma/client';
import type { DraftStatus } from '../repositories';
import type { PolicyEvaluationResult } from './vaultPolicy/types';

/**
 * Input for creating a draft.
 */
export interface CreateDraftInput {
  recipient: string;
  amount: number | string;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  outputs?: Prisma.InputJsonValue | null;
  inputs?: Prisma.InputJsonValue | null;
  decoyOutputs?: Prisma.InputJsonValue | null;
  payjoinUrl?: string;
  isRBF?: boolean;
  label?: string;
  memo?: string;
  psbtBase64: string;
  fee?: number | string;
  totalInput?: number | string;
  totalOutput?: number | string;
  changeAmount?: number | string;
  changeAddress?: string;
  effectiveAmount?: number | string;
  inputPaths?: string[];
  agentId?: string | null;
  agentOperationalWalletId?: string | null;
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  notificationCreatedByUserId?: string | null;
  notificationCreatedByLabel?: string;
  /** Policy evaluation result from transaction creation; used to create approval requests. */
  policyEvaluation?: PolicyEvaluationResult;
}

export interface InitialSigningState {
  signedPsbtBase64: string | null;
  signedDeviceIds: string[];
  status: DraftStatus;
}

/**
 * Input for updating a draft.
 */
export interface UpdateDraftInput {
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  status?: DraftStatus;
  label?: string;
  memo?: string;
}

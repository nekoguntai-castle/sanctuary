import { z } from 'zod';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '../constants/drafts';

export const DraftIntegerValueSchema = z.custom<number | string>(
  (value) => (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ),
  { message: 'Expected a non-negative integer value' }
);

export const DraftFeeRateSchema = z.custom<number | string>(
  (value) => (
    (typeof value === 'number' && Number.isFinite(value) && value > 0) ||
    (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0)
  ),
  { message: 'Expected a positive fee rate' }
);

export const OptionalDraftTextSchema = z.union([z.string(), z.null()]);

export const DraftOutputRequestSchema = z.object({
  address: z.string().min(1),
  amount: DraftIntegerValueSchema,
  sendMax: z.boolean().optional(),
}).strict();

export const DraftInputRequestSchema = z.object({
  txid: z.string().regex(/^[a-fA-F0-9]{64}$/),
  vout: z.number().int().nonnegative(),
  address: z.string(),
  amount: DraftIntegerValueSchema,
}).strict();

export const DraftDecoyOutputRequestSchema = z.object({
  address: z.string().min(1),
  amount: DraftIntegerValueSchema,
}).strict();

export const CreateDraftRequestSchema = z.object({
  recipient: z.string().min(1),
  amount: DraftIntegerValueSchema,
  feeRate: DraftFeeRateSchema,
  selectedUtxoIds: z.array(z.string()).optional(),
  enableRBF: z.boolean().optional(),
  subtractFees: z.boolean().optional(),
  sendMax: z.boolean().optional(),
  outputs: z.array(DraftOutputRequestSchema).optional(),
  inputs: z.array(DraftInputRequestSchema).optional(),
  decoyOutputs: z.array(DraftDecoyOutputRequestSchema).optional(),
  payjoinUrl: z.string().optional(),
  isRBF: z.boolean().optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
  psbtBase64: z.string().min(1),
  fee: DraftIntegerValueSchema.optional(),
  totalInput: DraftIntegerValueSchema.optional(),
  totalOutput: DraftIntegerValueSchema.optional(),
  changeAmount: DraftIntegerValueSchema.optional(),
  changeAddress: z.string().optional(),
  effectiveAmount: DraftIntegerValueSchema.optional(),
  inputPaths: z.array(z.string().min(1)).optional(),
  signedPsbtBase64: z.string().min(1).optional(),
  signedDeviceId: z.string().min(1).optional(),
  intentId: z.string().min(1),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const UpdateDraftRequestSchema = z.object({
  signedPsbtBase64: z.string().min(1).optional(),
  signedDeviceId: z.string().min(1).optional(),
  status: z.enum(ACTIONABLE_DRAFT_STATUS_VALUES).optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
}).strict();

export type DraftIntegerValue = z.infer<typeof DraftIntegerValueSchema>;
export type DraftFeeRate = z.infer<typeof DraftFeeRateSchema>;
export type DraftOutputRequest = z.infer<typeof DraftOutputRequestSchema>;
export type DraftInputRequest = z.infer<typeof DraftInputRequestSchema>;
export type DraftDecoyOutputRequest = z.infer<typeof DraftDecoyOutputRequestSchema>;
export type CreateDraftRequest = z.infer<typeof CreateDraftRequestSchema>;
export type UpdateDraftRequest = z.infer<typeof UpdateDraftRequestSchema>;

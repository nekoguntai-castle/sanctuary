import { z } from 'zod';
import { MOBILE_API_REQUEST_LIMITS } from './mobileApiRequests';

/**
 * Shared batch transaction request contracts consumed by the wallet-scoped
 * `/wallets/:walletId/transactions/batch` route validation, OpenAPI request
 * documentation, and frontend request types.
 *
 * Bitcoin address validation against the wallet network remains in the route
 * because it needs the wallet record.
 */

const outputsArrayRequiredMessage = 'outputs array is required with at least one output';
const feeRateMinimumMessage = `feeRate must be at least ${MOBILE_API_REQUEST_LIMITS.minFeeRate} sat/vB`;
const feeRateMaximumMessage = `feeRate must be at most ${MOBILE_API_REQUEST_LIMITS.maxFeeRate} sat/vB`;
const singleSendMaxMessage = 'Only one output can have sendMax enabled';

const BatchTransactionOutputItemSchema = z
  .object({
    address: z.string().optional(),
    amount: z.number().optional(),
    sendMax: z.boolean().optional(),
  })
  .strict();

export const BatchTransactionRequestSchema = z
  .object({
    outputs: z
      .array(BatchTransactionOutputItemSchema, { message: outputsArrayRequiredMessage })
      .min(1, outputsArrayRequiredMessage),
    feeRate: z
      .number({ message: 'feeRate is required' })
      .min(MOBILE_API_REQUEST_LIMITS.minFeeRate, feeRateMinimumMessage)
      .max(MOBILE_API_REQUEST_LIMITS.maxFeeRate, feeRateMaximumMessage),
    selectedUtxoIds: z.array(z.string()).optional(),
    enableRBF: z.boolean().optional(),
    label: z.string().optional(),
    memo: z.string().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    let sendMaxCount = 0;
    data.outputs.forEach((output, index) => {
      const oneBasedIndex = index + 1;
      if (typeof output.address !== 'string' || output.address.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Output ${oneBasedIndex}: address is required`,
          path: ['outputs', index, 'address'],
        });
      }
      if (!output.sendMax) {
        if (typeof output.amount !== 'number' || output.amount <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Output ${oneBasedIndex}: amount is required (or set sendMax: true)`,
            path: ['outputs', index, 'amount'],
          });
        }
      } else {
        sendMaxCount += 1;
      }
    });
    if (sendMaxCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: singleSendMaxMessage,
        path: ['outputs'],
      });
    }
  });

export type BatchTransactionOutputInput = z.input<typeof BatchTransactionRequestSchema>['outputs'][number];
export type BatchTransactionRequest = z.infer<typeof BatchTransactionRequestSchema>;

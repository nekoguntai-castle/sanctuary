import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toLabelDetailDto, toLabelSummaryDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { parseToolLimit, truncateRows } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const labelListBudget = { maxRows: 200, maxBytes: 96_000 };
const labelDetailBudget = { maxRows: 100, maxBytes: 128_000 };

const listLabelsInputSchema = {
  walletId: z.string().uuid(),
  query: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().positive().optional(),
} as const;

const labelDetailInputSchema = {
  walletId: z.string().uuid(),
  labelId: z.string().uuid(),
} as const;

export const listLabelsTool: AssistantReadToolDefinition<typeof listLabelsInputSchema> = {
  name: 'list_labels',
  title: 'List Labels',
  description: 'List wallet labels with transaction and address usage counts',
  inputSchema: listLabelsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: labelListBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const rowLimit = parseToolLimit(input.limit, listLabelsTool.budgets);
    const found = await assistantReadRepository.findWalletLabelsForAssistant(input.walletId, {
      query: input.query,
      limit: rowLimit + 1,
    });
    const { rows, truncation } = truncateRows(found, rowLimit);
    const labels = rows.map(toLabelSummaryDto);

    return createToolEnvelope({
      tool: listLabelsTool,
      context,
      data: { walletId: input.walletId, count: labels.length, labels },
      summary: `Returned ${labels.length} labels.`,
      facts: [{ label: 'label_count', value: labels.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'labels' }],
      truncation,
      audit: { walletCount: 1, rowCount: labels.length },
    });
  },
};

export const labelDetailTool: AssistantReadToolDefinition<typeof labelDetailInputSchema> = {
  name: 'get_label_detail',
  title: 'Get Label Detail',
  description: 'Return a label and its associated transactions and addresses',
  inputSchema: labelDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose raw addresses or txids.',
  },
  budgets: labelDetailBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const label = await assistantReadRepository.findWalletLabelDetailForAssistant(input.walletId, input.labelId);
    if (!label) {
      throw new AssistantToolError(404, 'Label not found');
    }

    const detail = toLabelDetailDto(label);
    const returnedRows = detail.transactions.length + detail.addresses.length;
    const totalRows = detail.transactionCount + detail.addressCount;

    return createToolEnvelope({
      tool: labelDetailTool,
      context,
      data: { walletId: input.walletId, label: detail },
      summary: `Label ${detail.name} has ${detail.transactionCount} transaction and ${detail.addressCount} address associations.`,
      facts: [
        { label: 'transaction_association_count', value: detail.transactionCount },
        { label: 'address_association_count', value: detail.addressCount },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'labels' }],
      redactions: ['address_derivation_paths'],
      truncation: {
        truncated: totalRows > returnedRows,
        ...(totalRows > returnedRows
          ? { reason: 'row_limit', rowLimit: labelDetailBudget.maxRows, returnedRows }
          : {}),
      },
      audit: { walletCount: 1, rowCount: returnedRows },
    });
  },
};

export const labelReadTools = [listLabelsTool, labelDetailTool];

import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toInsightDetailDto, toInsightSummaryDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { parseToolLimit, truncateRows } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const insightBudget = { maxRows: 100, maxBytes: 128_000 };

const insightTypeSchema = z.enum(['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation']);
const insightSeveritySchema = z.enum(['info', 'warning', 'critical']);
const insightStatusSchema = z.enum(['active', 'dismissed', 'acted_on', 'expired']);

const listInsightsInputSchema = {
  walletId: z.string().uuid(),
  status: insightStatusSchema.optional(),
  type: insightTypeSchema.optional(),
  severity: insightSeveritySchema.optional(),
  limit: z.number().int().positive().optional(),
} as const;

const insightDetailInputSchema = {
  walletId: z.string().uuid(),
  insightId: z.string().uuid(),
} as const;

export const listInsightsTool: AssistantReadToolDefinition<typeof listInsightsInputSchema> = {
  name: 'list_insights',
  title: 'List Insights',
  description: 'List wallet intelligence insights without raw structured insight data',
  inputSchema: listInsightsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: insightBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const rowLimit = parseToolLimit(input.limit, listInsightsTool.budgets);
    const found = await assistantReadRepository.findWalletInsightsForAssistant(
      input.walletId,
      {
        status: input.status,
        type: input.type,
        severity: input.severity,
      },
      rowLimit + 1
    );
    const { rows, truncation } = truncateRows(found, rowLimit);
    const insights = rows.map(toInsightSummaryDto);

    return createToolEnvelope({
      tool: listInsightsTool,
      context,
      data: { walletId: input.walletId, count: insights.length, insights },
      summary: `Returned ${insights.length} insights.`,
      facts: [{ label: 'insight_count', value: insights.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'ai_insights' }],
      redactions: ['insight_analysis', 'insight_structured_data'],
      truncation,
      audit: { walletCount: 1, rowCount: insights.length },
    });
  },
};

export const insightDetailTool: AssistantReadToolDefinition<typeof insightDetailInputSchema> = {
  name: 'get_insight_detail',
  title: 'Get Insight Detail',
  description: 'Return one wallet intelligence insight with analysis text but without raw structured data',
  inputSchema: insightDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: insightBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const insight = await assistantReadRepository.findWalletInsightDetailForAssistant(
      input.walletId,
      input.insightId
    );
    if (!insight) {
      throw new AssistantToolError(404, 'Insight not found');
    }

    const detail = toInsightDetailDto(insight);
    return createToolEnvelope({
      tool: insightDetailTool,
      context,
      data: { walletId: input.walletId, insight: detail },
      summary: `Insight ${detail.title} has severity ${detail.severity}.`,
      facts: [
        { label: 'insight_type', value: detail.type },
        { label: 'insight_severity', value: detail.severity },
        { label: 'insight_status', value: detail.status },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'ai_insights' }],
      redactions: ['insight_structured_data'],
      audit: { walletCount: 1, rowCount: 1 },
    });
  },
};

export const insightReadTools = [listInsightsTool, insightDetailTool];

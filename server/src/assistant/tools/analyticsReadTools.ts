import * as z from 'zod/v4';
import {
  assistantReadRepository,
  draftRepository,
  intelligenceRepository,
  transactionRepository,
} from '../../repositories';
import config from '../../config';
import { toDraftStatusDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { enforceDateRange, parseDateInput, uniqueStrings } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const balanceHistoryMaxWallets = 20;
const analyticsBudget = { maxRows: 500, maxWallets: balanceHistoryMaxWallets, maxBytes: 192_000 };
const draftBudget = { maxRows: 500, maxBytes: 128_000 };

type PeriodUnit = 'd' | 'w' | 'm' | 'y';

const walletAnalyticsInputSchema = {
  walletId: z.string().uuid(),
  metric: z.enum(['velocity', 'utxo_age', 'tx_types', 'fees']),
  period: z.string().optional(),
} as const;

const balanceHistoryInputSchema = {
  walletIds: z.array(z.string().uuid()).min(1).max(balanceHistoryMaxWallets),
  startDate: z.string(),
  bucketUnit: z.enum(['hour', 'day', 'week', 'month']).default('day'),
} as const;

const draftStatusesInputSchema = {
  walletId: z.string().uuid(),
} as const;

// Preserve the existing MCP period shorthand while bounding analytics windows by config.
function periodToDays(period: string | undefined, fallback = 30): number {
  if (!period) return fallback;
  const match = /^(\d+)(d|w|m|y)$/.exec(period.trim().toLowerCase());
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return fallback;
  const days = amount * periodUnitDays(match[2] as PeriodUnit);
  if (!Number.isSafeInteger(days) || days <= 0) return fallback;
  return Math.min(days, config.mcp.maxDateRangeDays);
}

function periodUnitDays(unit: PeriodUnit): number {
  switch (unit) {
    case 'd':
      return 1;
    case 'w':
      return 7;
    case 'm':
      return 30;
    case 'y':
      return 365;
  }
}

function toFeeAggregateDto(fees: {
  _count: { id: number };
  _sum: { fee: bigint | number | null };
  _avg: { fee: bigint | number | null };
}) {
  return {
    count: fees._count.id,
    sumFee: fees._sum.fee?.toString() ?? null,
    averageFee: fees._avg.fee?.toString() ?? null,
  };
}

async function executeWalletAnalyticsMetric(walletId: string, metric: string, days: number) {
  if (metric === 'velocity') {
    return {
      summary: 'Transaction velocity calculated.',
      data: { periodDays: days, velocity: await intelligenceRepository.getTransactionVelocity(walletId, days) },
    };
  }
  if (metric === 'utxo_age') {
    return {
      summary: 'UTXO age distribution calculated.',
      data: { distribution: await intelligenceRepository.getUtxoAgeDistribution(walletId) },
    };
  }
  if (metric === 'tx_types') {
    return {
      summary: 'Transaction type distribution calculated.',
      data: { types: await transactionRepository.groupByType(walletId) },
    };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fees = await assistantReadRepository.aggregateFees(walletId, cutoff);
  return {
    summary: 'Fee analytics calculated.',
    data: { periodDays: days, fees: toFeeAggregateDto(fees) },
  };
}

export const walletAnalyticsTool: AssistantReadToolDefinition<typeof walletAnalyticsInputSchema> = {
  name: 'get_wallet_analytics',
  title: 'Get Wallet Analytics',
  description: 'Read-only analytics for wallet transactions, UTXOs, and fees',
  inputSchema: walletAnalyticsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: analyticsBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const days = periodToDays(input.period);
    const metric = await executeWalletAnalyticsMetric(input.walletId, input.metric, days);
    const data = { walletId: input.walletId, metric: input.metric, ...metric.data };

    return createToolEnvelope({
      tool: walletAnalyticsTool,
      context,
      data,
      summary: metric.summary,
      facts: [{ label: 'metric', value: input.metric }],
      provenanceSources: [
        { type: 'sanctuary_repository', label: 'transactions' },
        { type: 'sanctuary_repository', label: 'utxos' },
      ],
      audit: { walletCount: 1 },
    });
  },
};

export const balanceHistoryTool: AssistantReadToolDefinition<typeof balanceHistoryInputSchema> = {
  name: 'get_balance_history',
  title: 'Get Balance History',
  description: 'Bucketed balance deltas across up to 20 accessible wallets',
  inputSchema: balanceHistoryInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet_set',
    walletIdsInput: 'walletIds',
    description: 'Requires read access to every requested wallet.',
  },
  budgets: analyticsBudget,
  async execute(input, context) {
    const walletIds = uniqueStrings(input.walletIds).slice(0, balanceHistoryMaxWallets);
    await Promise.all(walletIds.map(walletId => context.authorizeWalletAccess(walletId)));
    const startDate = parseDateInput(input.startDate);
    if (!startDate) {
      throw new AssistantToolError(400, 'startDate must be a valid date string');
    }
    enforceDateRange(startDate, new Date());

    const buckets = await transactionRepository.getBucketedBalanceDeltas(
      walletIds,
      startDate,
      input.bucketUnit
    );

    let cumulativeFromStart = BigInt(0);
    const history = buckets.map(bucket => {
      cumulativeFromStart += bucket.amount;
      return {
        bucket: bucket.bucket,
        deltaSats: bucket.amount.toString(),
        cumulativeDeltaSats: cumulativeFromStart.toString(),
      };
    });

    return createToolEnvelope({
      tool: balanceHistoryTool,
      context,
      data: { walletIds, startDate: input.startDate, bucketUnit: input.bucketUnit, history },
      summary: `Returned ${history.length} balance buckets.`,
      facts: [{ label: 'bucket_count', value: history.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'transactions' }],
      audit: { walletCount: walletIds.length, rowCount: history.length },
    });
  },
};

export const draftStatusesTool: AssistantReadToolDefinition<typeof draftStatusesInputSchema> = {
  name: 'get_draft_statuses',
  title: 'Get Draft Statuses',
  description: 'Read draft transaction status without exposing PSBT material',
  inputSchema: draftStatusesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: draftBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const drafts = await draftRepository.findByWalletId(input.walletId);
    const draftStatuses = drafts.map(toDraftStatusDto);

    return createToolEnvelope({
      tool: draftStatusesTool,
      context,
      data: { walletId: input.walletId, drafts: draftStatuses },
      summary: `Returned ${draftStatuses.length} draft statuses.`,
      facts: [{ label: 'draft_count', value: draftStatuses.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'draft_transactions' }],
      redactions: ['draft_psbt_material'],
      audit: { walletCount: 1, rowCount: draftStatuses.length },
    });
  },
};

export const analyticsReadTools = [
  walletAnalyticsTool,
  balanceHistoryTool,
  draftStatusesTool,
];

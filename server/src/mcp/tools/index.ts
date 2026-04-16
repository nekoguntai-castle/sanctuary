import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { Prisma } from '../../generated/prisma/client';
import {
  draftRepository,
  intelligenceRepository,
  mcpReadRepository,
  policyRepository,
  transactionRepository,
  utxoRepository,
  walletRepository,
} from '../../repositories';
import { requireMcpWalletAccess } from '../auth';
import { getCachedBtcPrice, getCachedFeeEstimates } from '../cache';
import {
  toAddressDto,
  toDraftStatusDto,
  toPolicyDto,
  toTransactionDto,
  toUtxoDto,
  toWalletDto,
} from '../dto';
import {
  enforceDateRange,
  getMcpContext,
  McpHttpError,
  parseDateInput,
  parseLimit,
  parseSats,
  toolResult,
  uniqueStrings,
} from '../types';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const genericOutputSchema = z.object({}).passthrough();

function periodToDays(period: string | undefined, fallback = 30): number {
  if (!period) return fallback;
  const match = /^(\d+)(d|w|m|y)$/.exec(period.trim().toLowerCase());
  if (!match) return fallback;

  const amount = Number(match[1]);
  switch (match[2]) {
    case 'd':
      return amount;
    case 'w':
      return amount * 7;
    case 'm':
      return amount * 30;
    case 'y':
      return amount * 365;
    default:
      return fallback;
  }
}

function dateRangeWhere(dateFrom?: string, dateTo?: string): Prisma.DateTimeNullableFilter | undefined {
  const startDate = parseDateInput(dateFrom);
  const endDate = parseDateInput(dateTo);
  enforceDateRange(startDate, endDate);

  if (!startDate && !endDate) {
    return undefined;
  }

  return {
    ...(startDate ? { gte: startDate } : {}),
    ...(endDate ? { lte: endDate } : {}),
  };
}

function amountWhere(
  minAmount?: string | number,
  maxAmount?: string | number
): Prisma.BigIntFilter | undefined {
  const min = parseSats(minAmount);
  const max = parseSats(maxAmount);

  if (min === undefined && max === undefined) {
    return undefined;
  }

  return {
    ...(min !== undefined ? { gte: min } : {}),
    ...(max !== undefined ? { lte: max } : {}),
  };
}

export function registerMcpTools(server: McpServer): void {
  server.registerTool(
    'query_transactions',
    {
      title: 'Query Transactions',
      description: 'Search and filter wallet transactions',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
        type: z.enum(['sent', 'received', 'consolidation']).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        minAmount: z.union([z.string(), z.number()]).optional(),
        maxAmount: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);

      const where: Prisma.TransactionWhereInput = { walletId: args.walletId };
      if (args.type) where.type = args.type;
      const range = dateRangeWhere(args.dateFrom, args.dateTo);
      if (range) where.blockTime = range;
      const amount = amountWhere(args.minAmount, args.maxAmount);
      if (amount) where.amount = amount;

      const limit = parseLimit(args.limit?.toString());
      const transactions = await mcpReadRepository.queryTransactions(where, limit);

      return toolResult(`Found ${transactions.length} transactions.`, {
        walletId: args.walletId,
        count: transactions.length,
        transactions: transactions.map(toTransactionDto),
      });
    }
  );

  server.registerTool(
    'query_utxos',
    {
      title: 'Query UTXOs',
      description: 'Filter wallet UTXOs by spent, frozen, and amount status',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
        spent: z.boolean().optional(),
        frozen: z.boolean().optional(),
        minAmount: z.union([z.string(), z.number()]).optional(),
        maxAmount: z.union([z.string(), z.number()]).optional(),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);

      const where: Prisma.UTXOWhereInput = { walletId: args.walletId };
      if (args.spent !== undefined) where.spent = args.spent;
      if (args.frozen !== undefined) where.frozen = args.frozen;
      const amount = amountWhere(args.minAmount, args.maxAmount);
      if (amount) where.amount = amount;

      const limit = parseLimit(args.limit?.toString());
      const utxos = await mcpReadRepository.queryUtxos(where, limit);

      return toolResult(`Found ${utxos.length} UTXOs.`, {
        walletId: args.walletId,
        count: utxos.length,
        utxos: utxos.map(toUtxoDto),
      });
    }
  );

  server.registerTool(
    'search_addresses',
    {
      title: 'Search Addresses',
      description: 'Search wallet addresses by address text, use status, and label presence',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
        query: z.string().optional(),
        used: z.boolean().optional(),
        hasLabels: z.boolean().optional(),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);

      const where: Prisma.AddressWhereInput = { walletId: args.walletId };
      if (args.query) where.address = { contains: args.query };
      if (args.used !== undefined) where.used = args.used;
      if (args.hasLabels === true) where.addressLabels = { some: {} };
      if (args.hasLabels === false) where.addressLabels = { none: {} };

      const limit = parseLimit(args.limit?.toString());
      const addresses = await mcpReadRepository.searchAddresses(where, limit);

      return toolResult(`Found ${addresses.length} addresses.`, {
        walletId: args.walletId,
        count: addresses.length,
        addresses: addresses.map(toAddressDto),
      });
    }
  );

  server.registerTool(
    'get_wallet_overview',
    {
      title: 'Get Wallet Overview',
      description: 'Comprehensive read-only summary for one wallet',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);

      const [wallet, balance, txCount, utxoCount, draftCount, policies, activeInsightCount] = await Promise.all([
        walletRepository.findByIdWithAccess(args.walletId, context.userId),
        utxoRepository.aggregateUnspent(args.walletId),
        transactionRepository.countByWalletId(args.walletId),
        utxoRepository.countByWalletId(args.walletId, { spent: false }),
        mcpReadRepository.countDrafts(args.walletId),
        policyRepository.findAllPoliciesForWallet(args.walletId),
        intelligenceRepository.countActiveInsights(args.walletId),
      ]);

      if (!wallet) {
        throw new McpHttpError(404, 'Wallet not found');
      }

      const overview = {
        wallet: toWalletDto(wallet),
        balance: {
          totalSats: balance._sum.amount ?? BigInt(0),
          utxoCount: balance._count._all,
        },
        counts: {
          transactions: txCount,
          unspentUtxos: utxoCount,
          drafts: draftCount,
          policies: policies.length,
          activeInsights: activeInsightCount,
        },
        policies: policies.map(toPolicyDto),
        asOf: new Date().toISOString(),
      };

      return toolResult(`Wallet ${wallet.name} has ${overview.balance.totalSats.toString()} sats.`, overview);
    }
  );

  server.registerTool(
    'get_wallet_analytics',
    {
      title: 'Get Wallet Analytics',
      description: 'Read-only analytics for wallet transactions, UTXOs, and fees',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
        metric: z.enum(['velocity', 'utxo_age', 'tx_types', 'fees']),
        period: z.string().optional(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      const days = periodToDays(args.period);

      if (args.metric === 'velocity') {
        const velocity = await intelligenceRepository.getTransactionVelocity(args.walletId, days);
        return toolResult('Transaction velocity calculated.', {
          walletId: args.walletId,
          metric: args.metric,
          periodDays: days,
          velocity,
        });
      }

      if (args.metric === 'utxo_age') {
        const distribution = await intelligenceRepository.getUtxoAgeDistribution(args.walletId);
        return toolResult('UTXO age distribution calculated.', {
          walletId: args.walletId,
          metric: args.metric,
          distribution,
        });
      }

      if (args.metric === 'tx_types') {
        const types = await transactionRepository.groupByType(args.walletId);
        return toolResult('Transaction type distribution calculated.', {
          walletId: args.walletId,
          metric: args.metric,
          types,
        });
      }

      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const fees = await mcpReadRepository.aggregateFees(args.walletId, cutoff);

      return toolResult('Fee analytics calculated.', {
        walletId: args.walletId,
        metric: args.metric,
        periodDays: days,
        fees,
      });
    }
  );

  server.registerTool(
    'get_balance_history',
    {
      title: 'Get Balance History',
      description: 'Bucketed balance deltas across up to 20 accessible wallets',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletIds: z.array(z.string().uuid()).min(1).max(20),
        startDate: z.string(),
        bucketUnit: z.enum(['hour', 'day', 'week', 'month']).default('day'),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      const walletIds = uniqueStrings(args.walletIds).slice(0, 20);
      for (const walletId of walletIds) {
        await requireMcpWalletAccess(walletId, context);
      }

      const startDate = parseDateInput(args.startDate);
      if (!startDate) {
        throw new McpHttpError(400, 'startDate must be a valid date string');
      }
      enforceDateRange(startDate, new Date());

      const buckets = await transactionRepository.getBucketedBalanceDeltas(
        walletIds,
        startDate,
        args.bucketUnit
      );

      let cumulativeFromStart = BigInt(0);
      const history = buckets.map(bucket => {
        cumulativeFromStart += bucket.amount;
        return {
          bucket: bucket.bucket,
          deltaSats: bucket.amount,
          cumulativeDeltaSats: cumulativeFromStart,
        };
      });

      return toolResult(`Returned ${history.length} balance buckets.`, {
        walletIds,
        startDate,
        bucketUnit: args.bucketUnit,
        history,
      });
    }
  );

  server.registerTool(
    'get_fee_estimates',
    {
      title: 'Get Fee Estimates',
      description: 'Current cached fee estimates; never fetches from external services',
      annotations: readOnlyAnnotations,
      inputSchema: {},
      outputSchema: genericOutputSchema,
    },
    async (_args, extra) => {
      getMcpContext(extra);
      const fees = await getCachedFeeEstimates();
      return toolResult('Cached fee estimates returned.', { fees });
    }
  );

  server.registerTool(
    'convert_price',
    {
      title: 'Convert BTC Price',
      description: 'Convert sats to fiat or fiat to sats using cached BTC price data',
      annotations: readOnlyAnnotations,
      inputSchema: {
        sats: z.union([z.string(), z.number()]).optional(),
        fiatAmount: z.number().positive().optional(),
        currency: z.string().min(3).max(8).default('USD'),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      getMcpContext(extra);
      const price = await getCachedBtcPrice(args.currency);

      if (!price.available || price.price === null) {
        return toolResult(`No cached ${price.currency} price is available.`, {
          price,
          conversion: null,
        });
      }

      if ((args.sats === undefined && args.fiatAmount === undefined) || (args.sats !== undefined && args.fiatAmount !== undefined)) {
        throw new McpHttpError(400, 'Provide exactly one of sats or fiatAmount');
      }

      const conversion = args.sats !== undefined
        ? {
            direction: 'sats_to_fiat',
            sats: parseSats(args.sats),
            fiatAmount: Number(parseSats(args.sats)) / 100_000_000 * price.price,
            currency: price.currency,
          }
        : {
            direction: 'fiat_to_sats',
            fiatAmount: args.fiatAmount,
            sats: Math.round((args.fiatAmount ?? 0) / price.price * 100_000_000).toString(),
            currency: price.currency,
          };

      return toolResult('Price conversion calculated from cached data.', {
        price,
        conversion,
      });
    }
  );

  server.registerTool(
    'get_draft_statuses',
    {
      title: 'Get Draft Statuses',
      description: 'Read draft transaction status without exposing PSBT material',
      annotations: readOnlyAnnotations,
      inputSchema: {
        walletId: z.string().uuid(),
      },
      outputSchema: genericOutputSchema,
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      const drafts = await draftRepository.findByWalletId(args.walletId);
      return toolResult(`Returned ${drafts.length} draft statuses.`, {
        walletId: args.walletId,
        drafts: drafts.map(toDraftStatusDto),
      });
    }
  );
}

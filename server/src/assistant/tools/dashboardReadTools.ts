import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toWalletDto } from './dto';
import { satsString } from './summary';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { parseToolLimit, uniqueStrings } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const dashboardBudget = { maxRows: 100, maxBytes: 128_000 };

const dashboardSummaryInputSchema = {
  network: z.enum(['mainnet', 'testnet', 'signet', 'regtest']).optional(),
  limit: z.number().int().positive().optional(),
} as const;

// Convert sparse Prisma groupBy count rows into wallet-id keyed lookups.
function countMap(rows: Array<Record<string, any>>): Map<string, number> {
  return new Map(rows.map(row => [row.walletId, row._count?.id ?? 0]));
}

// Prisma groupBy aggregate rows are sparse when a wallet has no matching rows.
function balanceMap(rows: Array<Record<string, any>>): Map<string, { count: number; amountSats: string }> {
  return new Map(rows.map(row => [
    row.walletId,
    {
      count: row._count?.id ?? 0,
      amountSats: satsString(row._sum?.amount),
    },
  ]));
}

// Keep network rollups model-friendly while preserving exact satoshi strings.
function summarizeNetworks(wallets: Array<{ network: string; balanceSats: string }>) {
  const networks = new Map<string, { walletCount: number; balanceSats: bigint }>();
  for (const wallet of wallets) {
    const current = networks.get(wallet.network) ?? { walletCount: 0, balanceSats: 0n };
    current.walletCount += 1;
    current.balanceSats += BigInt(wallet.balanceSats);
    networks.set(wallet.network, current);
  }
  return Array.from(networks.entries()).map(([network, summary]) => ({
    network,
    walletCount: summary.walletCount,
    balanceSats: summary.balanceSats.toString(),
  }));
}

export const dashboardSummaryTool: AssistantReadToolDefinition<typeof dashboardSummaryInputSchema> = {
  name: 'get_dashboard_summary',
  title: 'Get Dashboard Summary',
  description: 'Portfolio-style summary for accessible wallets, balances, networks, sync status, and pending activity',
  inputSchema: dashboardSummaryInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated user; MCP wallet scopes restrict which wallets are included.',
  },
  budgets: dashboardBudget,
  async execute(input, context) {
    const rowLimit = parseToolLimit(input.limit, dashboardSummaryTool.budgets);
    const scopedWalletIds = context.walletScopeIds ? uniqueStrings(context.walletScopeIds) : undefined;
    const summary = await assistantReadRepository.getDashboardSummary(context.actor.userId, {
      walletIds: scopedWalletIds,
      network: input.network,
      limit: rowLimit,
    });

    const balances = balanceMap(summary.balances);
    const transactionCounts = countMap(summary.transactionCounts);
    const pendingCounts = countMap(summary.pendingCounts);
    const wallets = summary.wallets.map(wallet => {
      const balance = balances.get(wallet.id) ?? { count: 0, amountSats: '0' };
      return {
        wallet: toWalletDto(wallet),
        balance: {
          unspentSats: balance.amountSats,
          unspentUtxoCount: balance.count,
        },
        counts: {
          addresses: wallet._count.addresses,
          devices: wallet._count.devices,
          drafts: wallet._count.draftTransactions,
          transactions: transactionCounts.get(wallet.id) ?? 0,
          pendingTransactions: pendingCounts.get(wallet.id) ?? 0,
        },
      };
    });

    const walletRollups = wallets.map(item => ({
      network: item.wallet.network,
      balanceSats: item.balance.unspentSats,
    }));
    const totalBalance = walletRollups.reduce((total, wallet) => total + BigInt(wallet.balanceSats), 0n);
    const totalTransactions = wallets.reduce((total, wallet) => total + wallet.counts.transactions, 0);
    const totalPending = wallets.reduce((total, wallet) => total + wallet.counts.pendingTransactions, 0);

    return createToolEnvelope({
      tool: dashboardSummaryTool,
      context,
      data: {
        walletCount: wallets.length,
        totalBalanceSats: totalBalance.toString(),
        totalTransactions,
        pendingTransactions: totalPending,
        networks: summarizeNetworks(walletRollups),
        wallets,
        scoped: scopedWalletIds !== undefined,
        asOf: new Date().toISOString(),
      },
      summary: `Dashboard summary includes ${wallets.length} accessible wallets.`,
      facts: [
        { label: 'wallet_count', value: wallets.length },
        { label: 'total_balance_sats', value: totalBalance.toString(), unit: 'sats' },
        { label: 'pending_transaction_count', value: totalPending },
      ],
      provenanceSources: [
        { type: 'sanctuary_repository', label: 'wallets' },
        { type: 'sanctuary_repository', label: 'utxos' },
        { type: 'sanctuary_repository', label: 'transactions' },
      ],
      audit: { walletCount: wallets.length, rowCount: wallets.length },
    });
  },
};

export const dashboardReadTools = [dashboardSummaryTool];

import * as z from 'zod/v4';
import type { Prisma } from '../../generated/prisma/client';
import {
  assistantReadRepository,
  intelligenceRepository,
  policyRepository,
  transactionRepository,
  utxoRepository,
  walletRepository,
} from '../../repositories';
import { toAddressDto, toPolicyDto, toTransactionDto, toUtxoDto, toWalletDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { amountWhere, dateRangeWhere, parseToolLimit, truncateRows } from './utils';

// Wallet tools expose GUI-readable wallet data only after adapter-owned access checks.
// Raw address search is marked high-sensitivity; draft tools redact PSBT material.
const genericOutputSchema = z.object({}).passthrough();
const listBudget = { maxRows: 500, maxBytes: 128_000 };
const walletBudget = { maxRows: 500, maxBytes: 192_000 };

const queryTransactionsInputSchema = {
  walletId: z.string().uuid(),
  type: z.enum(['sent', 'received', 'consolidation']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minAmount: z.union([z.string(), z.number()]).optional(),
  maxAmount: z.union([z.string(), z.number()]).optional(),
  limit: z.number().int().positive().optional(),
} as const;

const queryUtxosInputSchema = {
  walletId: z.string().uuid(),
  spent: z.boolean().optional(),
  frozen: z.boolean().optional(),
  minAmount: z.union([z.string(), z.number()]).optional(),
  maxAmount: z.union([z.string(), z.number()]).optional(),
  limit: z.number().int().positive().optional(),
} as const;

const searchAddressesInputSchema = {
  walletId: z.string().uuid(),
  query: z.string().optional(),
  used: z.boolean().optional(),
  hasLabels: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
} as const;

const walletOverviewInputSchema = {
  walletId: z.string().uuid(),
} as const;

export const queryTransactionsTool: AssistantReadToolDefinition<typeof queryTransactionsInputSchema> = {
  name: 'query_transactions',
  title: 'Query Transactions',
  description: 'Search and filter wallet transactions',
  inputSchema: queryTransactionsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: listBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const where: Prisma.TransactionWhereInput = { walletId: input.walletId };
    if (input.type) where.type = input.type;
    const range = dateRangeWhere(input.dateFrom, input.dateTo);
    if (range) where.blockTime = range;
    const amount = amountWhere(input.minAmount, input.maxAmount);
    if (amount) where.amount = amount;

    const rowLimit = parseToolLimit(input.limit, queryTransactionsTool.budgets);
    const found = await assistantReadRepository.queryTransactions(where, rowLimit + 1);
    const { rows, truncation } = truncateRows(found, rowLimit);
    const transactions = rows.map(toTransactionDto);

    return createToolEnvelope({
      tool: queryTransactionsTool,
      context,
      data: { walletId: input.walletId, count: transactions.length, transactions },
      summary: `Found ${transactions.length} transactions.`,
      facts: [{ label: 'transaction_count', value: transactions.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'transactions' }],
      truncation,
      audit: { walletCount: 1, rowCount: transactions.length },
    });
  },
};

export const queryUtxosTool: AssistantReadToolDefinition<typeof queryUtxosInputSchema> = {
  name: 'query_utxos',
  title: 'Query UTXOs',
  description: 'Filter wallet UTXOs by spent, frozen, and amount status',
  inputSchema: queryUtxosInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: listBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const where: Prisma.UTXOWhereInput = { walletId: input.walletId };
    if (input.spent !== undefined) where.spent = input.spent;
    if (input.frozen !== undefined) where.frozen = input.frozen;
    const amount = amountWhere(input.minAmount, input.maxAmount);
    if (amount) where.amount = amount;

    const rowLimit = parseToolLimit(input.limit, queryUtxosTool.budgets);
    const found = await assistantReadRepository.queryUtxos(where, rowLimit + 1);
    const { rows, truncation } = truncateRows(found, rowLimit);
    const utxos = rows.map(toUtxoDto);

    return createToolEnvelope({
      tool: queryUtxosTool,
      context,
      data: { walletId: input.walletId, count: utxos.length, utxos },
      summary: `Found ${utxos.length} UTXOs.`,
      facts: [{ label: 'utxo_count', value: utxos.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'utxos' }],
      redactions: ['draft_psbt_material'],
      truncation,
      audit: { walletCount: 1, rowCount: utxos.length },
    });
  },
};

export const searchAddressesTool: AssistantReadToolDefinition<typeof searchAddressesInputSchema> = {
  name: 'search_addresses',
  title: 'Search Addresses',
  description: 'Search wallet addresses by address text, use status, and label presence',
  inputSchema: searchAddressesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose raw addresses.',
  },
  budgets: listBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const where: Prisma.AddressWhereInput = { walletId: input.walletId };
    if (input.query) where.address = { contains: input.query };
    if (input.used !== undefined) where.used = input.used;
    if (input.hasLabels === true) where.addressLabels = { some: {} };
    if (input.hasLabels === false) where.addressLabels = { none: {} };

    const rowLimit = parseToolLimit(input.limit, searchAddressesTool.budgets);
    const found = await assistantReadRepository.searchAddresses(where, rowLimit + 1);
    const { rows, truncation } = truncateRows(found, rowLimit);
    const addresses = rows.map(toAddressDto);

    return createToolEnvelope({
      tool: searchAddressesTool,
      context,
      data: { walletId: input.walletId, count: addresses.length, addresses },
      summary: `Found ${addresses.length} addresses.`,
      facts: [{ label: 'address_count', value: addresses.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'addresses' }],
      truncation,
      audit: { walletCount: 1, rowCount: addresses.length },
    });
  },
};

export const walletOverviewTool: AssistantReadToolDefinition<typeof walletOverviewInputSchema> = {
  name: 'get_wallet_overview',
  title: 'Get Wallet Overview',
  description: 'Comprehensive read-only summary for one wallet',
  inputSchema: walletOverviewInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: walletBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const [wallet, balance, txCount, utxoCount, draftCount, policies, activeInsightCount] = await Promise.all([
      walletRepository.findByIdWithAccess(input.walletId, context.actor.userId),
      utxoRepository.aggregateUnspent(input.walletId),
      transactionRepository.countByWalletId(input.walletId),
      utxoRepository.countByWalletId(input.walletId, { spent: false }),
      assistantReadRepository.countDrafts(input.walletId),
      policyRepository.findAllPoliciesForWallet(input.walletId),
      intelligenceRepository.countActiveInsights(input.walletId),
    ]);

    if (!wallet) {
      throw new AssistantToolError(404, 'Wallet not found');
    }

    const totalSats = (balance._sum.amount ?? BigInt(0)).toString();
    const overview = {
      wallet: toWalletDto(wallet),
      balance: {
        totalSats,
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

    return createToolEnvelope({
      tool: walletOverviewTool,
      context,
      data: overview,
      summary: `Wallet ${wallet.name} has ${totalSats} sats.`,
      facts: [
        { label: 'balance_total_sats', value: totalSats, unit: 'sats' },
        { label: 'transaction_count', value: txCount },
        { label: 'unspent_utxo_count', value: utxoCount },
      ],
      provenanceSources: [
        { type: 'sanctuary_repository', label: 'wallets' },
        { type: 'sanctuary_repository', label: 'utxos' },
        { type: 'sanctuary_repository', label: 'transactions' },
      ],
      audit: { walletCount: 1 },
    });
  },
};

export const walletReadTools = [
  queryTransactionsTool,
  queryUtxosTool,
  searchAddressesTool,
  walletOverviewTool,
];

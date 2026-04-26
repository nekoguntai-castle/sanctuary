import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toTransactionDetailDto, toTransactionDto } from './dto';
import { buildTransactionStats } from './summary';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { parseToolLimit, truncateRows } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const transactionBudget = { maxRows: 250, maxBytes: 192_000 };
// Bitcoin transaction IDs are 32-byte hashes represented as 64 hex characters; execution lowercases them.
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

const transactionStatsInputSchema = {
  walletId: z.string().uuid(),
} as const;

const pendingTransactionsInputSchema = {
  walletId: z.string().uuid(),
  limit: z.number().int().positive().optional(),
} as const;

const transactionDetailInputSchema = {
  walletId: z.string().uuid(),
  txid: z.string().regex(TXID_PATTERN),
} as const;

export const transactionStatsTool: AssistantReadToolDefinition<typeof transactionStatsInputSchema> = {
  name: 'get_transaction_stats',
  title: 'Get Transaction Stats',
  description: 'Transaction count, type totals, fee totals, and current balance for a wallet',
  inputSchema: transactionStatsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: transactionBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const stats = buildTransactionStats(await assistantReadRepository.getTransactionStats(input.walletId));

    return createToolEnvelope({
      tool: transactionStatsTool,
      context,
      data: { walletId: input.walletId, stats },
      summary: `Wallet has ${stats.totalCount} transactions.`,
      facts: [
        { label: 'transaction_count', value: stats.totalCount },
        { label: 'sent_count', value: stats.sentCount },
        { label: 'received_count', value: stats.receivedCount },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'transactions' }],
      audit: { walletCount: 1 },
    });
  },
};

export const pendingTransactionsTool: AssistantReadToolDefinition<typeof pendingTransactionsInputSchema> = {
  name: 'get_pending_transactions',
  title: 'Get Pending Transactions',
  description: 'Read pending wallet transactions from Sanctuary state without external mempool fetches',
  inputSchema: pendingTransactionsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: transactionBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const rowLimit = parseToolLimit(input.limit, pendingTransactionsTool.budgets);
    const found = await assistantReadRepository.findPendingTransactions(input.walletId, rowLimit + 1);
    const { rows, truncation } = truncateRows(found, rowLimit);
    const transactions = rows.map(transaction => ({
      ...toTransactionDto(transaction),
      timeInQueueSeconds: Math.max(0, Math.floor((Date.now() - transaction.createdAt.getTime()) / 1000)),
    }));

    return createToolEnvelope({
      tool: pendingTransactionsTool,
      context,
      data: { walletId: input.walletId, count: transactions.length, transactions },
      summary: `Found ${transactions.length} pending transactions.`,
      facts: [{ label: 'pending_transaction_count', value: transactions.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'transactions' }],
      warnings: ['Pending transaction fee-rate fields are based on stored Sanctuary state only.'],
      truncation,
      audit: { walletCount: 1, rowCount: transactions.length },
    });
  },
};

export const transactionDetailTool: AssistantReadToolDefinition<typeof transactionDetailInputSchema> = {
  name: 'get_transaction_detail',
  title: 'Get Transaction Detail',
  description: 'Read a wallet transaction with labels, wallet metadata, and structured inputs/outputs',
  inputSchema: transactionDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose raw transaction identifiers.',
  },
  budgets: transactionBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const transaction = await assistantReadRepository.findWalletTransactionDetail(
      input.walletId,
      input.txid.toLowerCase()
    );
    if (!transaction) {
      throw new AssistantToolError(404, 'Transaction not found');
    }
    const detail = toTransactionDetailDto(transaction);

    return createToolEnvelope({
      tool: transactionDetailTool,
      context,
      data: { walletId: input.walletId, transaction: detail },
      summary: `Transaction ${detail.txid} is ${detail.type} for ${detail.amount} sats.`,
      facts: [
        { label: 'transaction_amount_sats', value: detail.amount, unit: 'sats' },
        { label: 'transaction_confirmations', value: detail.confirmations },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'transactions' }],
      redactions: ['raw_transaction_hex'],
      audit: { walletCount: 1, rowCount: 1 },
    });
  },
};

export const transactionReadTools = [
  transactionStatsTool,
  pendingTransactionsTool,
  transactionDetailTool,
];

import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toWalletDeviceSummaryDto, toWalletDto } from './dto';
import { buildAddressSummary, buildTransactionStats, buildUtxoSummary } from './summary';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const walletDetailBudget = { maxRows: 250, maxBytes: 160_000 };

const walletDetailSummaryInputSchema = {
  walletId: z.string().uuid(),
} as const;

function summarizeSharing(wallet: Record<string, any>) {
  const roles: Record<string, number> = {};
  for (const user of wallet.users ?? []) {
    const role = typeof user.role === 'string' ? user.role : 'unknown';
    roles[role] = (roles[role] ?? 0) + 1;
  }
  return {
    directUserCount: wallet.users?.length ?? 0,
    roleCounts: roles,
    group: wallet.group
      ? {
          present: true,
          role: wallet.groupRole,
        }
      : {
          present: false,
          role: null,
        },
  };
}

export const walletDetailSummaryTool: AssistantReadToolDefinition<typeof walletDetailSummaryInputSchema> = {
  name: 'get_wallet_detail_summary',
  title: 'Get Wallet Detail Summary',
  description: 'Wallet detail read summary with devices, sharing, addresses, transactions, and UTXO state',
  inputSchema: walletDetailSummaryInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: walletDetailBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const [wallet, transactionStats, utxoSummary, addressSummary] = await Promise.all([
      assistantReadRepository.findWalletDetailSummary(input.walletId, context.actor.userId),
      assistantReadRepository.getTransactionStats(input.walletId),
      assistantReadRepository.getUtxoSummary(input.walletId),
      assistantReadRepository.getAddressSummary(input.walletId),
    ]);

    if (!wallet) {
      throw new AssistantToolError(404, 'Wallet not found');
    }

    const detail = {
      wallet: toWalletDto(wallet),
      devices: {
        count: wallet.devices.length,
        signers: wallet.devices.map(toWalletDeviceSummaryDto),
      },
      sharing: summarizeSharing(wallet),
      counts: {
        addresses: wallet._count.addresses,
        transactions: wallet._count.transactions,
        utxos: wallet._count.utxos,
        drafts: wallet._count.draftTransactions,
        policies: wallet._count.vaultPolicies,
      },
      transactionStats: buildTransactionStats(transactionStats),
      utxoSummary: buildUtxoSummary(utxoSummary),
      addressSummary: buildAddressSummary(addressSummary),
      asOf: new Date().toISOString(),
    };

    return createToolEnvelope({
      tool: walletDetailSummaryTool,
      context,
      data: detail,
      summary: `Wallet ${wallet.name} has ${detail.utxoSummary.total.amountSats} sats across ${detail.utxoSummary.total.count} unspent UTXOs.`,
      facts: [
        { label: 'wallet_balance_sats', value: detail.utxoSummary.total.amountSats, unit: 'sats' },
        { label: 'transaction_count', value: detail.counts.transactions },
        { label: 'address_count', value: detail.counts.addresses },
      ],
      provenanceSources: [
        { type: 'sanctuary_repository', label: 'wallets' },
        { type: 'sanctuary_repository', label: 'addresses' },
        { type: 'sanctuary_repository', label: 'transactions' },
        { type: 'sanctuary_repository', label: 'utxos' },
      ],
      redactions: ['device_xpubs', 'device_fingerprints', 'shared_usernames', 'group_names'],
      audit: { walletCount: 1 },
    });
  },
};

export const walletDetailReadTools = [walletDetailSummaryTool];

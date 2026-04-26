import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { buildUtxoSummary } from './summary';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const utxoSummaryBudget = { maxRows: 50, maxBytes: 64_000 };

const utxoSummaryInputSchema = {
  walletId: z.string().uuid(),
} as const;

export const utxoSummaryTool: AssistantReadToolDefinition<typeof utxoSummaryInputSchema> = {
  name: 'get_utxo_summary',
  title: 'Get UTXO Summary',
  description: 'Read UTXO state totals for a wallet: spendable, frozen, unconfirmed, locked, spent, and total',
  inputSchema: utxoSummaryInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: utxoSummaryBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const summary = buildUtxoSummary(await assistantReadRepository.getUtxoSummary(input.walletId));

    return createToolEnvelope({
      tool: utxoSummaryTool,
      context,
      data: { walletId: input.walletId, summary },
      summary: `Wallet has ${summary.total.count} unspent UTXOs totaling ${summary.total.amountSats} sats.`,
      facts: [
        { label: 'unspent_utxo_count', value: summary.total.count },
        { label: 'unspent_balance_sats', value: summary.total.amountSats, unit: 'sats' },
        { label: 'spendable_utxo_count', value: summary.spendable.count },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'utxos' }],
      redactions: ['utxo_outpoint_list'],
      audit: { walletCount: 1 },
    });
  },
};

export const utxoReadTools = [utxoSummaryTool];

import * as z from 'zod/v4';
import { assistantReadRepository, utxoRepository } from '../../repositories';
import * as privacyService from '../../services/privacyService';
import { buildUtxoSummary } from './summary';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const utxoSummaryBudget = { maxRows: 50, maxBytes: 64_000 };
const utxoPrivacyBudget = { maxRows: 1, maxBytes: 32_000 };

const utxoSummaryInputSchema = {
  walletId: z.string().uuid(),
} as const;

const utxoPrivacyInputSchema = {
  utxoId: z.string().min(1),
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

export const utxoPrivacyTool: AssistantReadToolDefinition<typeof utxoPrivacyInputSchema> = {
  name: 'get_utxo_privacy',
  title: 'Get UTXO Privacy',
  description: 'Get a privacy score for one UTXO after resolving and authorizing its wallet',
  inputSchema: utxoPrivacyInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    description: 'Requires read access to the wallet that owns the requested UTXO.',
  },
  budgets: utxoPrivacyBudget,
  async execute(input, context) {
    const walletId = await utxoRepository.findWalletIdByUtxoId(input.utxoId);
    if (!walletId) {
      throw new AssistantToolError(404, 'UTXO not found');
    }
    await context.authorizeWalletAccess(walletId);
    const score = await privacyService.calculateUtxoPrivacy(input.utxoId);

    return createToolEnvelope({
      tool: utxoPrivacyTool,
      context,
      data: {
        walletId,
        utxoId: input.utxoId,
        score,
      },
      summary: `UTXO privacy grade is ${score.grade} with score ${score.score}.`,
      facts: [
        { label: 'privacy_grade', value: score.grade },
        { label: 'privacy_score', value: score.score },
        { label: 'warning_count', value: score.warnings.length },
      ],
      provenanceSources: [{ type: 'computed', label: 'utxo_privacy' }],
      redactions: [
        'utxo_addresses',
        'utxo_txids',
        'utxo_outpoints',
      ],
      audit: { walletCount: 1, rowCount: 1 },
    });
  },
};

export const utxoReadTools = [utxoSummaryTool, utxoPrivacyTool];

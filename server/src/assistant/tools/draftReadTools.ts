import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toDraftDetailDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const draftDetailBudget = { maxRows: 100, maxBytes: 128_000 };

const draftDetailInputSchema = {
  walletId: z.string().uuid(),
  draftId: z.string().uuid(),
} as const;

export const draftDetailTool: AssistantReadToolDefinition<typeof draftDetailInputSchema> = {
  name: 'get_draft_detail',
  title: 'Get Draft Detail',
  description: 'Read one draft transaction without PSBTs, input paths, or raw draft JSON payloads',
  inputSchema: draftDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose recipient or change addresses.',
  },
  budgets: draftDetailBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const draft = await assistantReadRepository.findDraftDetailForAssistant(input.walletId, input.draftId);
    if (!draft) {
      throw new AssistantToolError(404, 'Draft not found');
    }

    const detail = toDraftDetailDto(draft);
    const approvalCount = detail.approvalRequests.length;
    return createToolEnvelope({
      tool: draftDetailTool,
      context,
      data: { walletId: input.walletId, draft: detail },
      summary: `Draft ${detail.id} is ${detail.status} with approval status ${detail.approvalStatus}.`,
      facts: [
        { label: 'draft_status', value: detail.status },
        { label: 'approval_status', value: detail.approvalStatus },
        { label: 'approval_request_count', value: approvalCount },
        { label: 'locked_utxo_count', value: detail.lockedUtxoCount },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'draft_transactions' }],
      redactions: [
        'draft_psbt_material',
        'draft_signed_psbt_material',
        'draft_input_paths',
        'draft_raw_input_output_json',
        'approval_vote_user_ids',
        'approval_vote_reasons',
      ],
      audit: { walletCount: 1, rowCount: 1 + approvalCount },
    });
  },
};

export const draftReadTools = [draftDetailTool];

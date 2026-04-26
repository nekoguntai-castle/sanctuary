import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toPolicyAddressDto, toPolicyEventDto, toPolicySummaryDto } from './dto';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { enforceDateRange, parseDateInput, parseToolLimit, truncateRows } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const policyListBudget = { maxRows: 100, maxBytes: 128_000 };
const policyEventBudget = { maxRows: 200, maxBytes: 128_000 };

const listPoliciesInputSchema = {
  walletId: z.string().uuid(),
  includeInherited: z.boolean().default(true),
} as const;

const policyDetailInputSchema = {
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  listType: z.enum(['allow', 'deny']).optional(),
} as const;

const policyEventsInputSchema = {
  walletId: z.string().uuid(),
  policyId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).max(80).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().positive().optional(),
} as const;

function summarizePolicyCounts(policies: Array<{ type: string; sourceType: string; enabled: boolean }>) {
  return {
    enabled: policies.filter(policy => policy.enabled).length,
    disabled: policies.filter(policy => !policy.enabled).length,
    byType: countBy(policies, policy => policy.type),
    bySourceType: countBy(policies, policy => policy.sourceType),
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export const listPoliciesTool: AssistantReadToolDefinition<typeof listPoliciesInputSchema> = {
  name: 'list_policies',
  title: 'List Policies',
  description: 'List wallet policies with sanitized configuration summaries',
  inputSchema: listPoliciesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: policyListBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const result = await assistantReadRepository.findWalletPoliciesForAssistant(
      input.walletId,
      input.includeInherited
    );
    if (!result.wallet) {
      throw new AssistantToolError(404, 'Wallet not found');
    }

    const policies = result.policies.map(toPolicySummaryDto);
    return createToolEnvelope({
      tool: listPoliciesTool,
      context,
      data: {
        walletId: input.walletId,
        includeInherited: input.includeInherited,
        count: policies.length,
        counts: summarizePolicyCounts(policies),
        policies,
      },
      summary: `Returned ${policies.length} policies.`,
      facts: [
        { label: 'policy_count', value: policies.length },
        { label: 'enabled_policy_count', value: policies.filter(policy => policy.enabled).length },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'vault_policies' }],
      redactions: ['policy_user_id_lists'],
      audit: { walletCount: 1, rowCount: policies.length },
    });
  },
};

export const policyDetailTool: AssistantReadToolDefinition<typeof policyDetailInputSchema> = {
  name: 'get_policy_detail',
  title: 'Get Policy Detail',
  description: 'Return one wallet-visible policy with address lists and recent policy events',
  inputSchema: policyDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose policy-controlled addresses.',
  },
  budgets: policyListBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const detail = await assistantReadRepository.findWalletPolicyDetailForAssistant(
      input.walletId,
      input.policyId,
      input.listType
    );
    if (!detail) {
      throw new AssistantToolError(404, 'Policy not found');
    }

    const rowLimit = parseToolLimit(undefined, policyDetailTool.budgets);
    const { rows: addressRows, truncation } = truncateRows(detail.addresses, rowLimit);
    const addresses = addressRows.map(toPolicyAddressDto);
    const recentEvents = detail.recentEvents.map(toPolicyEventDto);
    return createToolEnvelope({
      tool: policyDetailTool,
      context,
      data: {
        walletId: input.walletId,
        policy: toPolicySummaryDto(detail.policy),
        addressCount: addresses.length,
        addresses,
        recentEvents,
        eventTotal: detail.eventTotal,
      },
      summary: `Policy ${detail.policy.name} returned with ${addresses.length} address entries.`,
      facts: [
        { label: 'policy_address_count', value: addresses.length },
        { label: 'policy_event_total', value: detail.eventTotal },
      ],
      provenanceSources: [
        { type: 'sanctuary_repository', label: 'vault_policies' },
        { type: 'sanctuary_repository', label: 'policy_events' },
      ],
      redactions: ['policy_user_id_lists', 'policy_address_added_by', 'policy_event_details', 'policy_event_user_ids'],
      truncation,
      audit: { walletCount: 1, rowCount: 1 + addresses.length + recentEvents.length },
    });
  },
};

export const policyEventsTool: AssistantReadToolDefinition<typeof policyEventsInputSchema> = {
  name: 'get_policy_events',
  title: 'Get Policy Events',
  description: 'List policy event metadata for a wallet without raw event detail payloads',
  inputSchema: policyEventsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose policy or draft identifiers.',
  },
  budgets: policyEventBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const from = parseDateInput(input.dateFrom);
    const to = parseDateInput(input.dateTo);
    enforceDateRange(from, to);
    const rowLimit = parseToolLimit(input.limit, policyEventsTool.budgets);
    const result = await assistantReadRepository.findWalletPolicyEventsForAssistant(input.walletId, {
      policyId: input.policyId,
      eventType: input.eventType,
      from,
      to,
      limit: rowLimit + 1,
    });
    const { rows, truncation } = truncateRows(result.events, rowLimit);
    const events = rows.map(toPolicyEventDto);

    return createToolEnvelope({
      tool: policyEventsTool,
      context,
      data: { walletId: input.walletId, total: result.total, count: events.length, events },
      summary: `Returned ${events.length} policy events.`,
      facts: [
        { label: 'policy_event_count', value: events.length },
        { label: 'policy_event_total', value: result.total },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'policy_events' }],
      redactions: ['policy_event_details', 'policy_event_user_ids'],
      truncation,
      audit: { walletCount: 1, rowCount: events.length },
    });
  },
};

export const policyReadTools = [
  listPoliciesTool,
  policyDetailTool,
  policyEventsTool,
];

import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition, type AssistantToolContext } from './types';
import { parseToolLimit, truncateRows } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const adminBudget = { maxRows: 100, maxBytes: 160_000 };

const adminOperationalInputSchema = {
  limit: z.number().int().positive().optional(),
} as const;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function requireAdminContext(context: AssistantToolContext): void {
  if (!context.actor.isAdmin) {
    throw new AssistantToolError(403, 'Admin access required');
  }
}

function walletSummary(wallet: any) {
  if (!wallet) return null;
  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    network: wallet.network,
  };
}

function summarizeDashboardRow(row: any) {
  return {
    agent: {
      id: row.agent.id,
      name: row.agent.name,
      status: row.agent.status,
      fundingWallet: walletSummary(row.agent.fundingWallet),
      operationalWallet: walletSummary(row.agent.operationalWallet),
      requireHumanApproval: row.agent.requireHumanApproval,
      notifyOnOperationalSpend: row.agent.notifyOnOperationalSpend,
      pauseOnUnexpectedSpend: row.agent.pauseOnUnexpectedSpend,
      lastFundingDraftAt: iso(row.agent.lastFundingDraftAt),
      revokedAt: iso(row.agent.revokedAt),
      createdAt: iso(row.agent.createdAt),
      updatedAt: iso(row.agent.updatedAt),
    },
    operationalBalanceSats: row.operationalBalanceSats.toString(),
    pendingFundingDraftCount: row.pendingFundingDraftCount,
    openAlertCount: row.openAlertCount,
    activeKeyCount: row.activeKeyCount,
    recentFundingDraftCount: row.recentFundingDrafts.length,
    recentOperationalSpendCount: row.recentOperationalSpends.length,
    recentAlertCount: row.recentAlerts.length,
    recentAlertsBySeverity: countBy(row.recentAlerts, (alert: any) => alert.severity),
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

function sumRows(rows: any[], getValue: (row: any) => number): number {
  return rows.reduce((total, row) => total + getValue(row), 0);
}

function sumBalances(rows: any[]): string {
  return rows.reduce((total, row) => total + row.operationalBalanceSats, 0n).toString();
}

export const adminOperationalSummaryTool: AssistantReadToolDefinition<typeof adminOperationalInputSchema> = {
  name: 'get_admin_operational_summary',
  title: 'Get Admin Operational Summary',
  description: 'Admin-only operational summary for linked wallet agents without secrets or signer fingerprints',
  inputSchema: adminOperationalInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'admin',
  requiredScope: {
    kind: 'admin',
    description: 'Requires an authenticated admin actor.',
  },
  budgets: adminBudget,
  async execute(input, context) {
    requireAdminContext(context);
    const rowLimit = parseToolLimit(input.limit, adminOperationalSummaryTool.budgets);
    const found = await assistantReadRepository.findAdminAgentDashboardRowsForAssistant(rowLimit + 1);
    const { rows, truncation } = truncateRows(found, rowLimit);
    const agents = rows.map(summarizeDashboardRow);

    return createToolEnvelope({
      tool: adminOperationalSummaryTool,
      context,
      data: {
        agentCount: agents.length,
        returnedAgentCount: agents.length,
        activeAgentCount: rows.filter(row => row.agent.status === 'active').length,
        revokedAgentCount: rows.filter(row => row.agent.revokedAt).length,
        totalOperationalBalanceSats: sumBalances(rows),
        pendingFundingDraftCount: sumRows(rows, row => row.pendingFundingDraftCount),
        openAlertCount: sumRows(rows, row => row.openAlertCount),
        activeKeyCount: sumRows(rows, row => row.activeKeyCount),
        agents,
        asOf: new Date().toISOString(),
      },
      summary: `Admin operational summary includes ${agents.length} linked wallet agents.`,
      facts: [
        { label: 'agent_count', value: agents.length },
        { label: 'open_alert_count', value: sumRows(rows, row => row.openAlertCount) },
        { label: 'pending_funding_draft_count', value: sumRows(rows, row => row.pendingFundingDraftCount) },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'agent_dashboard' }],
      redactions: [
        'agent_api_key_material',
        'signer_device_fingerprints',
        'agent_user_identity_details',
        'agent_alert_metadata',
      ],
      truncation,
      audit: { rowCount: agents.length },
    });
  },
};

export const adminReadTools = [adminOperationalSummaryTool];

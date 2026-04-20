import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { Metric } from './DashboardPrimitives';
import {
  formatDateTime,
  formatSats,
} from './agentWalletDashboardModel';

export function AgentWalletMetricGrid({ row }: { row: AgentWalletDashboardRow }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
      <Metric label="Operational balance" value={formatSats(row.operationalBalanceSats)} />
      <Metric label="Pending drafts" value={row.pendingFundingDraftCount.toString()} />
      <Metric label="Last request" value={formatDateTime(row.lastFundingDraft?.createdAt)} />
      <Metric label="Open alerts" value={row.openAlertCount.toString()} />
      <Metric label="Active keys" value={row.activeKeyCount.toString()} />
      <Metric label="Last spend" value={formatDateTime(row.lastOperationalSpend?.blockTime ?? row.lastOperationalSpend?.createdAt)} />
    </div>
  );
}

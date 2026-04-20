import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { AgentWalletRowActions } from './AgentWalletRowActions';
import { AgentWalletRowDetails } from './AgentWalletRowDetails';
import { AgentWalletRowHeader } from './AgentWalletRowHeader';
import { AgentWalletLinkGrid } from './AgentWalletRowLinks';
import { AgentWalletMetricGrid } from './AgentWalletRowMetrics';
import {
  getActiveApiKeys,
  isAgentRevoked,
} from './agentWalletDashboardModel';

export interface AgentWalletRowProps {
  row: AgentWalletDashboardRow;
  busyAction: string | null;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}

export function AgentWalletRow({
  row,
  busyAction,
  onStatusChange,
  onRevokeKey,
}: AgentWalletRowProps) {
  const { agent } = row;
  const activeKeys = getActiveApiKeys(agent);
  const revoked = isAgentRevoked(agent);

  return (
    <div className="rounded-lg border border-sanctuary-200 bg-white p-4 dark:border-sanctuary-800 dark:bg-sanctuary-900">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <AgentWalletRowHeader row={row} />
          <AgentWalletMetricGrid row={row} />
          <AgentWalletLinkGrid agent={agent} />
        </div>

        <AgentWalletRowActions
          row={row}
          busyAction={busyAction}
          revoked={revoked}
          onStatusChange={onStatusChange}
        />
      </div>

      <AgentWalletRowDetails
        row={row}
        activeKeys={activeKeys}
        busyAction={busyAction}
        onRevokeKey={onRevokeKey}
      />
    </div>
  );
}

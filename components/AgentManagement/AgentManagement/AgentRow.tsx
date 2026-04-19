import type { WalletAgentMetadata } from '../../../src/api/admin';
import { ActiveKeyList } from './ActiveKeyList';
import { AgentActionButtons } from './AgentActionButtons';
import { AgentHeader } from './AgentHeader';
import { AgentInfoGrid } from './AgentInfoGrid';
import { SummaryGrid } from './SummaryGrid';
import {
  getActiveAgentKeys,
  getAgentInfoBlocks,
  getMonitoringSummary,
  getPolicySummary,
  getTimelineSummary,
  isAgentRevoked,
} from './agentRowModel';

type AgentRowProps = {
  agent: WalletAgentMetadata;
  busyAction: string | null;
  onEdit: (agent: WalletAgentMetadata) => void;
  onRevoke: (agent: WalletAgentMetadata) => void;
  onOpenKeys: (agent: WalletAgentMetadata) => void;
  onOpenOverrides: (agent: WalletAgentMetadata) => void;
  onRevokeKey: (agent: WalletAgentMetadata, keyId: string) => void;
};

export function AgentRow({
  agent,
  busyAction,
  onEdit,
  onRevoke,
  onOpenKeys,
  onOpenOverrides,
  onRevokeKey,
}: AgentRowProps) {
  const activeKeys = getActiveAgentKeys(agent);
  const isRevoked = isAgentRevoked(agent);

  return (
    <div className="p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <AgentHeader agent={agent} />
          <AgentInfoGrid blocks={getAgentInfoBlocks(agent)} />
          <SummaryGrid items={getPolicySummary(agent)} className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400" />
          <SummaryGrid items={getMonitoringSummary(agent)} className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400" />
          <SummaryGrid items={getTimelineSummary(agent, activeKeys.length)} className="mt-3 flex flex-wrap gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400" />
          <ActiveKeyList activeKeys={activeKeys} agent={agent} onRevokeKey={onRevokeKey} />
        </div>

        <AgentActionButtons
          agent={agent}
          busyAction={busyAction}
          disabled={isRevoked}
          onEdit={onEdit}
          onRevoke={onRevoke}
          onOpenKeys={onOpenKeys}
          onOpenOverrides={onOpenOverrides}
        />
      </div>
    </div>
  );
}

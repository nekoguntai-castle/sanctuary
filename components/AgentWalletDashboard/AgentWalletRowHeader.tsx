import { Bot, ShieldCheck } from 'lucide-react';
import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { AgentStatusBadge } from './AgentStatusBadge';
import { canSpendNow } from './agentWalletDashboardModel';

export function AgentWalletRowHeader({ row }: { row: AgentWalletDashboardRow }) {
  const { agent } = row;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bot className="h-4 w-4 text-shared-600 dark:text-shared-300" />
      <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{agent.name}</h3>
      <AgentStatusBadge agent={agent} />
      {canSpendNow(row) && (
        <span className="inline-flex items-center gap-1 rounded-full border border-success-200 bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:border-success-800 dark:bg-success-900/20 dark:text-success-300">
          <ShieldCheck className="h-3 w-3" />
          Operational funds available
        </span>
      )}
    </div>
  );
}

import { AlertTriangle, Bot, Check, PauseCircle } from 'lucide-react';
import type { WalletAgentMetadata } from '../../../src/api/admin';

export function AgentHeader({ agent }: { agent: WalletAgentMetadata }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bot className="w-4 h-4 text-shared-600 dark:text-shared-300" />
      <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{agent.name}</h3>
      <AgentStatusBadge agent={agent} />
      <PauseOnSpendBadge enabled={agent.pauseOnUnexpectedSpend} />
    </div>
  );
}

function AgentStatusBadge({ agent }: { agent: WalletAgentMetadata }) {
  if (agent.status === 'active' && !agent.revokedAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
        <Check className="w-3 h-3" />
        Active
      </span>
    );
  }

  if (agent.status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
        <PauseCircle className="w-3 h-3" />
        Paused
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
      <AlertTriangle className="w-3 h-3" />
      Revoked
    </span>
  );
}

function PauseOnSpendBadge({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
      <AlertTriangle className="w-3 h-3" />
      Auto-pause on spend
    </span>
  );
}

import { AlertTriangle, Check, PauseCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WalletAgentMetadata } from '../../src/api/admin';
import { getAgentStatusBadgeKind } from './agentWalletDashboardModel';
import type { AgentStatusBadgeKind } from './agentWalletDashboardModel';

interface StatusBadgeConfig {
  Icon: LucideIcon;
  label: string;
  className: string;
}

const STATUS_BADGE_CONFIGS: Record<AgentStatusBadgeKind, StatusBadgeConfig> = {
  active: {
    Icon: Check,
    label: 'Active',
    className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  },
  paused: {
    Icon: PauseCircle,
    label: 'Paused',
    className: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  },
  revoked: {
    Icon: AlertTriangle,
    label: 'Revoked',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  },
};

export function AgentStatusBadge({ agent }: { agent: WalletAgentMetadata }) {
  const config = STATUS_BADGE_CONFIGS[getAgentStatusBadgeKind(agent)];
  const { Icon } = config;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

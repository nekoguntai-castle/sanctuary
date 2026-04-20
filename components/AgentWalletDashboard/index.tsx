import { AgentWalletDashboardView } from './AgentWalletDashboardView';
import { useAgentWalletDashboardController } from './useAgentWalletDashboardController';

export function AgentWalletDashboard() {
  const dashboard = useAgentWalletDashboardController();

  return <AgentWalletDashboardView {...dashboard} />;
}

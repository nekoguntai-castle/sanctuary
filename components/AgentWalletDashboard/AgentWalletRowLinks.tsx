import type { WalletAgentMetadata } from '../../src/api/admin';
import { WalletLinkBlock } from './DashboardPrimitives';
import { formatWalletType } from './agentWalletDashboardModel';

export function AgentWalletLinkGrid({ agent }: { agent: WalletAgentMetadata }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
      <WalletLinkBlock
        label="Funding wallet"
        walletId={agent.fundingWalletId}
        name={agent.fundingWallet?.name ?? agent.fundingWalletId}
        helper={formatWalletType(agent.fundingWallet?.type)}
      />
      <WalletLinkBlock
        label="Operational wallet"
        walletId={agent.operationalWalletId}
        name={agent.operationalWallet?.name ?? agent.operationalWalletId}
        helper={formatWalletType(agent.operationalWallet?.type)}
      />
    </div>
  );
}

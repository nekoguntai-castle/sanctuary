import { Users, Bot } from 'lucide-react';
import { Wallet, isMultisigType, getQuorumM, getQuorumN } from '../../types';
import type { WalletAgentLinkBadge } from './WalletHeader';
import type { SyncRetryInfo } from './types';
import { WalletSyncStatusBadge } from './WalletSyncStatusBadge';

interface WalletBadgesProps {
  wallet: Wallet;
  agentLinks: WalletAgentLinkBadge[];
  syncing: boolean;
  syncRetryInfo: SyncRetryInfo | null;
}

type WalletUserRole = 'owner' | 'signer' | 'viewer' | string | null | undefined;

function getNetworkBadgeClass(network: string): string {
  if (network === 'testnet') {
    return 'bg-testnet-100 text-testnet-800 border-testnet-200 dark:bg-testnet-500/10 dark:text-testnet-100 dark:border-testnet-500/30';
  }

  if (network === 'signet') {
    return 'bg-signet-100 text-signet-800 border-signet-200 dark:bg-signet-500/10 dark:text-signet-100 dark:border-signet-500/30';
  }

  return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20';
}

function getRoleBadgeClass(role: WalletUserRole): string {
  if (role === 'owner') {
    return 'bg-primary-600 text-white dark:bg-primary-100 dark:text-primary-700';
  }

  if (role === 'signer') {
    return 'bg-warning-600 text-white dark:bg-warning-100 dark:text-warning-700';
  }

  return 'bg-sanctuary-500 text-white dark:bg-sanctuary-900 dark:text-sanctuary-200';
}

function getRoleLabel(role: WalletUserRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'signer') return 'Signer';
  return 'Viewer';
}

function WalletTypeBadge({ wallet }: { wallet: Wallet }) {
  const isMultisig = isMultisigType(wallet.type);
  const className = isMultisig
    ? 'bg-warning-100 text-warning-800 border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
  const label = isMultisig
    ? `${getQuorumM(wallet.quorum)}/${getQuorumN(wallet.quorum, wallet.totalSigners)} Multisig`
    : 'Single Sig';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}

function NetworkBadge({ network }: { network: string | undefined }) {
  if (!network || network === 'mainnet') {
    return null;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${getNetworkBadgeClass(network)}`}>
      {network}
    </span>
  );
}

function RoleBadge({ role }: { role: WalletUserRole }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(role)}`}>
      {getRoleLabel(role)}
    </span>
  );
}

function AgentLinkBadge({ link }: { link: WalletAgentLinkBadge }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-600 text-white dark:bg-shared-100 dark:text-shared-700"
      title={`${link.agentName} links this wallet to ${link.linkedWalletName}`}
    >
      <Bot className="w-3 h-3" />
      {link.role === 'funding' ? 'Agent Funding Wallet' : 'Agent Operational Wallet'}
    </span>
  );
}

export function WalletBadges({ wallet, agentLinks, syncing, syncRetryInfo }: WalletBadgesProps) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      <WalletTypeBadge wallet={wallet} />
      <NetworkBadge network={wallet.network} />
      <WalletSyncStatusBadge wallet={wallet} syncing={syncing} syncRetryInfo={syncRetryInfo} />
      <RoleBadge role={wallet.userRole} />
      {wallet.isShared && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-600 text-white dark:bg-shared-100 dark:text-shared-700">
          <Users className="w-3 h-3" />
          Shared
        </span>
      )}
      {agentLinks.map((link) => (
        <AgentLinkBadge key={`${link.agentId}-${link.role}`} link={link} />
      ))}
    </div>
  );
}

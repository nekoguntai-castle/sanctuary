import type { NodeConfig as NodeConfigType } from '../../types';
import type { NetworkTab } from './types';

const NETWORK_TABS: NetworkTab[] = ['mainnet', 'testnet', 'signet'];

const NETWORK_COLORS: Record<NetworkTab, string> = {
  mainnet: 'border-mainnet-500 text-mainnet-600 dark:text-mainnet-400',
  testnet: 'border-testnet-500 text-testnet-600 dark:text-testnet-400',
  signet: 'border-signet-500 text-signet-600 dark:text-signet-400',
};

export function NetworkTabsRow({
  nodeConfig,
  activeNetworkTab,
  onNetworkTabChange,
  getServerCount,
}: {
  nodeConfig: NodeConfigType;
  activeNetworkTab: NetworkTab;
  onNetworkTabChange: (network: NetworkTab) => void;
  getServerCount: (network: NetworkTab) => number;
}) {
  return (
    <div className="flex border-b border-sanctuary-100 dark:border-sanctuary-800">
      {NETWORK_TABS.map(network => (
        <NetworkTabButton
          key={network}
          network={network}
          active={activeNetworkTab === network}
          enabled={isNetworkEnabled(nodeConfig, network)}
          serverCount={getServerCount(network)}
          onClick={() => onNetworkTabChange(network)}
        />
      ))}
    </div>
  );
}

function NetworkTabButton({
  network,
  active,
  enabled,
  serverCount,
  onClick,
}: {
  network: NetworkTab;
  active: boolean;
  enabled: boolean;
  serverCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${networkTabClass(network, active)}`}
    >
      <span className="capitalize">{network}</span>
      <NetworkTabBadge enabled={enabled} serverCount={serverCount} />
    </button>
  );
}

function NetworkTabBadge({
  enabled,
  serverCount,
}: {
  enabled: boolean;
  serverCount: number;
}) {
  if (!enabled) return <span className="ml-1.5 text-xs text-sanctuary-400">(off)</span>;
  return (
    <span className="ml-1.5 text-xs text-sanctuary-400">
      {serverCount > 0 ? `(${serverCount})` : ''}
    </span>
  );
}

function isNetworkEnabled(config: NodeConfigType, network: NetworkTab): boolean {
  if (network === 'mainnet') return true;
  if (network === 'testnet') return Boolean(config.testnetEnabled);
  return Boolean(config.signetEnabled);
}

function networkTabClass(network: NetworkTab, active: boolean): string {
  return active
    ? NETWORK_COLORS[network]
    : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300';
}

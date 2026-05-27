import type { NodeConfig as NodeConfigType } from '../../types';
import { useTabsA11y } from '../ui/useTabsA11y';
import {
  getNodeNetworkEnabled,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';
import type { NetworkTab } from './types';
import { formatNetworkTitle, getNetworkColorClass } from '../../src/app/networks';

const NETWORK_TABS: NetworkTab[] = ['mainnet', 'testnet3', 'testnet4', 'signet'];
type NodeNetworkTabButtonProps = ReturnType<
  ReturnType<typeof useTabsA11y<NetworkTab>>['getTabProps']
>;

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
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: NETWORK_TABS,
    activeTab: activeNetworkTab,
    onTabChange: onNetworkTabChange,
  });

  return (
    <div
      {...getTabListProps('Node network configuration')}
      className="flex border-b border-sanctuary-100 dark:border-sanctuary-800"
    >
      {NETWORK_TABS.map(network => (
        <NetworkTabButton
          key={network}
          network={network}
          active={activeNetworkTab === network}
          enabled={isNetworkEnabled(nodeConfig, network)}
          serverCount={getServerCount(network)}
          tabProps={getTabProps(network)}
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
  tabProps,
}: {
  network: NetworkTab;
  active: boolean;
  enabled: boolean;
  serverCount: number;
  tabProps: NodeNetworkTabButtonProps;
}) {
  return (
    <button
      {...tabProps}
      className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${networkTabClass(network, active)}`}
    >
      <span>{formatNetworkTitle(network)}</span>
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
  return getNodeNetworkEnabled(config as unknown as NodeNetworkConfigSource, network);
}

function networkTabClass(network: NetworkTab, active: boolean): string {
  return active
    ? getNetworkColorClass(network, 'activeTab')
    : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300';
}

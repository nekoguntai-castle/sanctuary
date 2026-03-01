/**
 * NodeConfig Module Types
 *
 * Shared types for the NodeConfig component and its subcomponents.
 */
import { NodeConfig as NodeConfigType, ElectrumServer } from '../../types';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as adminApi from '../../src/api/admin';

export type SectionId = 'external' | 'networks' | 'proxy';
export type NetworkTab = 'mainnet' | 'testnet' | 'signet';

export interface ExternalServicesSectionProps {
  nodeConfig: NodeConfigType;
  onConfigChange: (config: NodeConfigType) => void;
  expanded: boolean;
  onToggle: () => void;
  summary: string;
}

export interface NetworkConnectionsSectionProps {
  nodeConfig: NodeConfigType;
  servers: ElectrumServer[];
  poolStats: bitcoinApi.PoolStats | null;
  activeNetworkTab: NetworkTab;
  onNetworkTabChange: (tab: NetworkTab) => void;
  onConfigChange: (config: NodeConfigType) => void;
  onServersChange: (network: 'mainnet' | 'testnet' | 'signet', servers: ElectrumServer[]) => void;
  onTestConnection: (host: string, port: number, ssl: boolean) => Promise<{ success: boolean; message: string }>;
  expanded: boolean;
  onToggle: () => void;
  summary: string;
}

export interface ProxyTorSectionProps {
  nodeConfig: NodeConfigType;
  onConfigChange: (config: NodeConfigType) => void;
  torContainerStatus: adminApi.TorContainerStatus | null;
  isTorContainerLoading: boolean;
  torContainerMessage: string;
  showCustomProxy: boolean;
  proxyTestStatus: 'idle' | 'testing' | 'success' | 'error';
  proxyTestMessage: string;
  onProxyPreset: (preset: 'tor' | 'tor-browser' | 'tor-container') => void;
  onToggleCustomProxy: () => void;
  onTorContainerToggle: () => void;
  onRefreshTorStatus: () => void;
  onTestProxy: () => void;
  expanded: boolean;
  onToggle: () => void;
  summary: string;
}

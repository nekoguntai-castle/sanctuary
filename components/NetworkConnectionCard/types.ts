import { NodeConfig as NodeConfigType, ElectrumServer } from '../../types';
import * as bitcoinApi from '../../src/api/bitcoin';

export type NetworkType = 'mainnet' | 'testnet' | 'signet';
export type ConnectionMode = 'singleton' | 'pool';

export interface NetworkConnectionCardProps {
  network: NetworkType;
  config: NodeConfigType;
  servers: ElectrumServer[];
  poolStats?: bitcoinApi.PoolStats | null; // Pool stats with health history
  onConfigChange: (updates: Partial<NodeConfigType>) => void;
  onServersChange: (servers: ElectrumServer[]) => void;
  onTestConnection: (host: string, port: number, ssl: boolean) => Promise<{ success: boolean; message: string }>;
}

export interface NetworkColors {
  bg: string;
  border: string;
  text: string;
  accent: string;
  badge: string;
}

export interface PresetServer {
  name: string;
  host: string;
  port: number;
  useSsl: boolean;
}

export interface NewServerState {
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
}

export interface HealthHistoryBlocksProps {
  history: bitcoinApi.HealthCheckResult[];
  maxBlocks?: number;
}

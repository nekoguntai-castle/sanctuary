import { ElectrumServer } from '../../types';
import * as bitcoinApi from '../../src/api/bitcoin';

export type Network = 'mainnet' | 'testnet' | 'signet';

export interface ElectrumServerSettingsProps {
  poolEnabled?: boolean;
  onPoolEnabledChange?: (enabled: boolean) => void;
}

export interface NewServerData {
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
}

export interface HealthHistoryBlocksProps {
  history: bitcoinApi.HealthCheckResult[];
  maxBlocks?: number;
}

export interface ServerRowProps {
  server: ElectrumServer;
  index: number;
  totalCount: number;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testError: string;
  actionLoading: boolean;
  poolServerStats?: bitcoinApi.ServerStats;
  onMoveServer: (id: string, direction: 'up' | 'down') => void;
  onTestServer: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onEditServer: (server: ElectrumServer) => void;
  onDeleteServer: (id: string) => void;
}

export interface ServerFormProps {
  editingServerId: string | null;
  newServer: NewServerData;
  onNewServerChange: (data: NewServerData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export interface PresetServer {
  name: string;
  host: string;
  port: number;
  useSsl: boolean;
}

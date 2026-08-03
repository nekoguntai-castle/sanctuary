import type { Device as ApiDevice } from '../../../api/devices';
import type { Wallet as ApiWallet } from '../../../api/wallets';
import type { AppCapabilityStatus } from '../../../app/capabilities';
import type { TabNetwork } from '../../../app/networks';
import type { ExpandedState } from '../types';

export interface SidebarContentProps {
  user: { username: string; isAdmin?: boolean } | null;
  wallets: ApiWallet[];
  devices: ApiDevice[];
  selectedNetwork: TabNetwork;
  setSelectedNetwork: (network: TabNetwork) => void;
  networkAvailability: Record<TabNetwork, boolean>;
  expanded: ExpandedState;
  darkMode: boolean;
  toggleTheme: () => void;
  toggleSection: (section: keyof ExpandedState) => void;
  logout: () => void;
  getWalletCount: (walletId: string) => number;
  getDeviceCount: (deviceId: string) => number;
  onVersionClick: () => void;
  onOpenConsole: () => void;
  onOpenShortcuts: () => void;
  capabilities?: AppCapabilityStatus;
}

import { canEditWalletRole } from '../../utils/walletCapabilities';

type WalletDetailTabVisibility = (userRole: string) => boolean;

interface DefinedWalletDetailTab<TId extends string> {
  readonly id: TId;
  readonly label: string;
  readonly isVisible: WalletDetailTabVisibility;
  readonly badge?: 'drafts';
}

const defineWalletDetailTabs = <const T extends readonly DefinedWalletDetailTab<string>[]>(tabs: T) => tabs;

const visibleForAll: WalletDetailTabVisibility = () => true;
const visibleForEditors: WalletDetailTabVisibility = canEditWalletRole;
const visibleForOwners: WalletDetailTabVisibility = (userRole) => userRole === 'owner';

export const walletDetailTabDefinitions = defineWalletDetailTabs([
  { id: 'tx', label: 'Transactions', isVisible: visibleForAll },
  { id: 'utxo', label: 'UTXOs', isVisible: visibleForAll },
  { id: 'addresses', label: 'Addresses', isVisible: visibleForAll },
  { id: 'drafts', label: 'Drafts', isVisible: visibleForEditors, badge: 'drafts' },
  { id: 'stats', label: 'Stats', isVisible: visibleForAll },
  { id: 'access', label: 'Access', isVisible: visibleForOwners },
  { id: 'settings', label: 'Settings', isVisible: visibleForAll },
  { id: 'log', label: 'Log', isVisible: visibleForAll },
] as const);

export type WalletDetailTabId = (typeof walletDetailTabDefinitions)[number]['id'];
export type WalletDetailTabDefinition = DefinedWalletDetailTab<WalletDetailTabId>;

export const DEFAULT_WALLET_DETAIL_TAB: WalletDetailTabId = 'tx';

export const WALLET_DETAIL_TAB_IDS: WalletDetailTabId[] = walletDetailTabDefinitions.map((tab) => tab.id);

const walletDetailTabIdSet = new Set<WalletDetailTabId>(WALLET_DETAIL_TAB_IDS);

export const isWalletDetailTab = (value: unknown): value is WalletDetailTabId => {
  return typeof value === 'string' && walletDetailTabIdSet.has(value as WalletDetailTabId);
};

export const getWalletDetailTabs = (userRole: string): WalletDetailTabDefinition[] => {
  return walletDetailTabDefinitions.filter((tab) => tab.isVisible(userRole));
};

export const getWalletDetailTabDefinition = (tabId: WalletDetailTabId): WalletDetailTabDefinition => {
  const tab = walletDetailTabDefinitions.find((definition) => definition.id === tabId);

  if (!tab) {
    throw new Error(`Missing wallet detail tab definition: ${tabId}`);
  }

  return tab;
};

export const canShowWalletDetailTab = (tabId: WalletDetailTabId, userRole: string): boolean => {
  return getWalletDetailTabDefinition(tabId).isVisible(userRole);
};

export const resolveWalletDetailTab = (
  value: unknown,
  userRole: string,
  fallback: WalletDetailTabId = DEFAULT_WALLET_DETAIL_TAB,
): WalletDetailTabId => {
  if (!isWalletDetailTab(value)) {
    return fallback;
  }

  return canShowWalletDetailTab(value, userRole) ? value : fallback;
};

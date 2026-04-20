import type { ElementType, MouseEvent } from 'react';
import type { Wallet } from '../../../src/api/wallets';

export type TabId = 'insights' | 'chat' | 'settings';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: ElementType;
}

export type WalletOption = Pick<Wallet, 'id' | 'name'>;

export interface WalletSelectionController {
  selectedWalletId: string;
  selectedWallet?: WalletOption;
  dropdownOpen: boolean;
  toggleDropdown: (event: MouseEvent<HTMLButtonElement>) => void;
  selectWallet: (walletId: string) => void;
}

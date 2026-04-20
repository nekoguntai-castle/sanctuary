import React from 'react';
import type { AppNavItem } from '../../../src/app/appRoutes';
import type { Wallet as ApiWallet } from '../../../src/api/wallets';
import { EmptyState } from '../../ui/EmptyState';
import { NavItem } from '../NavItem';
import { SubNavItem } from '../SubNavItem';
import {
  getSortedWallets,
  getWalletActiveColor,
  getWalletSyncStatus,
  renderWalletIcon,
} from './sidebarItems';

interface SidebarWalletSectionProps {
  show: boolean;
  navItem: AppNavItem;
  wallets: ApiWallet[];
  isExpanded: boolean;
  onToggle: () => void;
  getWalletCount: (walletId: string) => number;
}

const WalletSubNavList: React.FC<Pick<SidebarWalletSectionProps, 'wallets' | 'getWalletCount'>> = ({
  wallets,
  getWalletCount,
}) => (
  <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
    {wallets.length === 0 && (
      <EmptyState
        compact
        title="No wallets created"
        actionLabel="Create wallet"
        actionTo="/wallets/create"
      />
    )}
    {getSortedWallets(wallets).map((wallet) => (
      <SubNavItem
        key={wallet.id}
        to={`/wallets/${wallet.id}`}
        label={wallet.name}
        icon={renderWalletIcon(wallet)}
        activeColorClass={getWalletActiveColor(wallet)}
        badgeCount={getWalletCount(wallet.id)}
        badgeSeverity="warning"
        statusDot={getWalletSyncStatus(wallet)}
      />
    ))}
  </div>
);

export const SidebarWalletSection: React.FC<SidebarWalletSectionProps> = ({
  show,
  navItem,
  wallets,
  isExpanded,
  onToggle,
  getWalletCount,
}) => {
  if (!show) return null;

  return (
    <>
      <div className="pt-5 pb-1.5">
        <div className="px-4 text-[9px] font-semibold text-sanctuary-400 dark:text-sanctuary-500 uppercase tracking-[0.15em]">
          Wallets
        </div>
      </div>
      <div className="space-y-1">
        <NavItem
          to={navItem.to}
          icon={navItem.icon}
          label={navItem.label}
          hasSubmenu
          isOpen={isExpanded}
          onToggle={onToggle}
        />
        {isExpanded && (
          <WalletSubNavList wallets={wallets} getWalletCount={getWalletCount} />
        )}
      </div>
    </>
  );
};

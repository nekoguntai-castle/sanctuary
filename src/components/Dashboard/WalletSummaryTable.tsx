import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Wallet } from '../../types';
import { isMultisigType } from '../../types';
import { Amount } from '../Amount';
import { WalletEmptyState } from '../ui/EmptyState';
import type { TabNetwork } from '../NetworkTabs';
import {
  getWalletSyncPresentation,
  type WalletSyncTone,
} from '../../utils/walletSyncPresentation';

const SYNC_ICON_TONE_CLASSES: Record<WalletSyncTone, string> = {
  syncing: 'text-primary-600 dark:text-primary-400',
  resyncing: 'text-primary-600 dark:text-primary-400',
  retrying: 'text-warning-600',
  success: 'text-success-600',
  stale: 'text-warning-600',
  failed: 'text-rose-600 dark:text-rose-400',
  partial: 'text-warning-600',
  cached: 'text-sanctuary-400',
  never: 'text-warning-600',
  unknown: 'text-warning-600',
};

function WalletSyncIcon({ wallet, now }: { wallet: Wallet; now: number }) {
  const { tone, icon: Icon, spinning } = getWalletSyncPresentation(wallet, null, now);
  return (
    <span className={`inline-flex items-center ${SYNC_ICON_TONE_CLASSES[tone]}`}>
      <Icon className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} />
    </span>
  );
}

function WalletSyncStatus({ wallet, now }: { wallet: Wallet; now: number }) {
  const description = getWalletSyncPresentation(wallet, null, now).description;
  return (
    <div className="relative group/sync inline-flex items-center justify-center">
      <WalletSyncIcon wallet={wallet} now={now} />
      <div className="tooltip-popup bottom-full left-1/2 -translate-x-1/2 mb-2">
        <div className="tooltip-arrow tooltip-arrow-centered -bottom-1 border-b border-r" />
        {description}
      </div>
    </div>
  );
}

function shouldIgnoreClick(event: MouseEvent<HTMLTableRowElement>) {
  if ((event.target as HTMLElement).closest('a') !== null) return true;
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function WalletSummaryRow({
  wallet,
  now,
  color,
  isHighlighted,
  onHover,
  onLeave,
  onNavigate,
}: {
  wallet: Wallet;
  now: number;
  color: string;
  isHighlighted: boolean;
  onHover: (walletId: string) => void;
  onLeave: () => void;
  onNavigate: (walletId: string) => void;
}) {
  const isMultisig = isMultisigType(wallet.type);
  const badgeClass = isMultisig
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:border-success-500/20';
  const syncDescription = getWalletSyncPresentation(wallet, null, now).description;
  return (
    <tr
      onClick={(event) => { if (!shouldIgnoreClick(event)) onNavigate(wallet.id); }}
      onMouseEnter={() => onHover(wallet.id)}
      onMouseLeave={onLeave}
      onFocus={() => onHover(wallet.id)}
      onBlur={onLeave}
      className={`group cursor-pointer transition-all duration-200 hover:shadow-sm active:bg-sanctuary-100 dark:active:bg-sanctuary-700 ${
        isHighlighted ? 'bg-sanctuary-50 dark:bg-sanctuary-800' : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
      }`}
      style={{ backgroundColor: isHighlighted ? undefined : 'transparent' }}
    >
      <td className="px-4 py-2.5 whitespace-nowrap"><div className={`w-2.5 h-2.5 rounded-full ${color}`} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Link to={`/wallets/${wallet.id}`} className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            {wallet.name}
          </Link>
          <span className="sm:hidden" role="img" aria-label={syncDescription}>
            <WalletSyncIcon wallet={wallet} now={now} />
          </span>
        </div>
      </td>
      <td className="hidden sm:table-cell px-4 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
          {isMultisig ? 'Multisig' : 'Single Sig'}
        </span>
      </td>
      <td className="hidden sm:table-cell px-4 py-2.5 whitespace-nowrap text-center"><WalletSyncStatus wallet={wallet} now={now} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap text-right"><Amount sats={wallet.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" /></td>
      <td className="px-4 py-2.5 whitespace-nowrap text-right"><ChevronRight className="w-4 h-4 text-sanctuary-300 group-hover:text-sanctuary-500 transition-colors" /></td>
    </tr>
  );
}

export function WalletSummaryTable({
  selectedNetwork,
  wallets,
  now,
  hoveredWalletId,
  getColor,
  onHover,
  onLeave,
}: {
  selectedNetwork: TabNetwork;
  wallets: Wallet[];
  now: number;
  hoveredWalletId: string | null;
  getColor: (index: number) => string;
  onHover: (walletId: string) => void;
  onLeave: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-transparent">
        <thead className="surface-secondary border-b border-sanctuary-100 dark:border-sanctuary-800">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-8" />
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Wallet Name</th>
            <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Type</th>
            <th scope="col" className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Sync</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Balance</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          {wallets.length === 0 && (
            <tr className="bg-transparent">
              <td colSpan={6} className="bg-transparent">
                <WalletEmptyState network={selectedNetwork} />
              </td>
            </tr>
          )}
          {wallets.map((wallet, index) => (
            <WalletSummaryRow
              key={wallet.id}
              wallet={wallet}
              now={now}
              color={getColor(index)}
              isHighlighted={hoveredWalletId === wallet.id}
              onHover={onHover}
              onLeave={onLeave}
              onNavigate={(walletId) => navigate(`/wallets/${walletId}`)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

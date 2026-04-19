import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { isMultisigType, type Transaction, type Wallet } from '../../../types';
import { Amount } from '../../Amount';
import { LabelBadges } from '../../LabelSelector';
import type { ClickableCellProps, TransactionCellProps } from './types';

const MULTISIG_BADGE_CLASS = 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20';
const SINGLE_SIG_BADGE_CLASS = 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

interface TransactionTypeMeta {
  Icon: LucideIcon;
  iconClassName: string;
  label: string;
}

interface LockBadgeMeta {
  label: string;
  title: string;
}

export function getHighlightClass(isHighlighted: boolean): string {
  return isHighlighted
    ? 'bg-warning-50 dark:bg-warning-950/20'
    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50';
}

export function getDirectionBorderClass(isConsolidation: boolean, isReceive: boolean): string {
  if (isConsolidation) return 'border-l-[3px] border-primary-500';
  if (isReceive) return 'border-l-[3px] border-success-500';

  return 'border-l-[3px] border-sanctuary-300 dark:border-sanctuary-600';
}

function getTransactionTypeMeta(isConsolidation: boolean, isReceive: boolean): TransactionTypeMeta {
  if (isConsolidation) {
    return {
      Icon: RefreshCw,
      iconClassName: 'bg-primary-100 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400',
      label: 'Consolidation',
    };
  }

  if (isReceive) {
    return {
      Icon: ArrowDownLeft,
      iconClassName: 'bg-success-100 text-success-600 dark:bg-success-500/10 dark:text-success-400',
      label: 'Received',
    };
  }

  return {
    Icon: ArrowUpRight,
    iconClassName: 'bg-sanctuary-200 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400',
    label: 'Sent',
  };
}

function getLockBadgeMeta(tx: Transaction): LockBadgeMeta | null {
  if (!tx.isFrozen && !tx.isLocked) return null;

  if (tx.isFrozen) {
    return {
      label: 'Frozen',
      title: 'Transaction has frozen UTXOs',
    };
  }

  return {
    label: 'Locked',
    title: tx.lockedByDraftLabel
      ? `Locked by draft: ${tx.lockedByDraftLabel}`
      : 'Transaction has draft-locked UTXOs',
  };
}

function getAmountClassName(isConsolidation: boolean, isReceive: boolean): string {
  if (isConsolidation) return 'text-sent-600 dark:text-sent-400';
  if (isReceive) return 'text-success-600 dark:text-success-400';

  return 'text-sanctuary-900 dark:text-sanctuary-100';
}

function getAmountSats(tx: Transaction, isConsolidation: boolean): number {
  return isConsolidation ? -Math.abs(tx.amount) : tx.amount;
}

function getConfirmationTitle(confirmations: number | undefined): string {
  const confirmationCount = Number(confirmations);
  if (!Number.isFinite(confirmationCount) || confirmationCount <= 0) return 'Pending confirmation';

  return `${(confirmations as number).toLocaleString()} confirmation${confirmationCount !== 1 ? 's' : ''}`;
}

function getWalletBadgeClass(txWallet: Wallet | undefined): string {
  return isMultisigType(txWallet?.type) ? MULTISIG_BADGE_CLASS : SINGLE_SIG_BADGE_CLASS;
}

function ClickableCell({ children, className = '', highlightClass, onTxClick, tx }: ClickableCellProps) {
  return (
    <td
      className={`${className} cursor-pointer transition-colors ${highlightClass}`}
      onClick={() => onTxClick(tx)}
    >
      {children}
    </td>
  );
}

function LockBadge({ badge }: { badge: LockBadgeMeta }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zen-vermilion/10 text-zen-vermilion border border-zen-vermilion/20"
      title={badge.title}
    >
      <Lock className="w-3 h-3 mr-1" />
      {badge.label}
    </span>
  );
}

function ConfirmationStatus({
  confirmationThreshold,
  confirmations,
  deepConfirmationThreshold,
}: {
  confirmationThreshold: number;
  confirmations: number;
  deepConfirmationThreshold: number;
}) {
  if (confirmations >= deepConfirmationThreshold) {
    return (
      <>
        <ShieldCheck className="w-3.5 h-3.5 mr-1 text-indigo-500" />
        <span className="text-indigo-600 dark:text-indigo-400">{confirmations?.toLocaleString() || ''}</span>
      </>
    );
  }

  if (confirmations >= confirmationThreshold) {
    return (
      <>
        <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-success-500" />
        <span className="text-sanctuary-700 dark:text-sanctuary-300">{confirmations}/{deepConfirmationThreshold}</span>
      </>
    );
  }

  if (confirmations > 0) {
    return (
      <span className="inline-flex items-center text-primary-600 dark:text-primary-400">
        <Clock className="w-3.5 h-3.5 mr-1" />
        {confirmations}/{deepConfirmationThreshold}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center text-warning-600 dark:text-warning-400">
      <Clock className="w-3.5 h-3.5 mr-1" />
      Pending
    </span>
  );
}

export function TransactionDateCell({
  directionBorderClass,
  highlightClass,
  onTxClick,
  tx,
}: TransactionCellProps & { directionBorderClass: string }) {
  return (
    <ClickableCell
      className={`${directionBorderClass} px-4 py-3 whitespace-nowrap text-sm text-sanctuary-700 dark:text-sanctuary-300 font-medium`}
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : 'Pending'}
    </ClickableCell>
  );
}

export function TransactionTypeCell({
  highlightClass,
  isConsolidation,
  isReceive,
  onTxClick,
  tx,
}: TransactionCellProps & { isConsolidation: boolean; isReceive: boolean }) {
  const meta = getTransactionTypeMeta(isConsolidation, isReceive);
  const badge = getLockBadgeMeta(tx);

  return (
    <ClickableCell
      className="px-4 py-3 whitespace-nowrap"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      <div className="flex items-center space-x-2">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${meta.iconClassName}`}>
          <meta.Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          {meta.label}
        </span>
        {badge && <LockBadge badge={badge} />}
      </div>
    </ClickableCell>
  );
}

export function TransactionAmountCell({
  highlightClass,
  isConsolidation,
  isReceive,
  onTxClick,
  tx,
}: TransactionCellProps & { isConsolidation: boolean; isReceive: boolean }) {
  return (
    <ClickableCell
      className="px-4 py-3 whitespace-nowrap text-right"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      <span className={`text-sm font-semibold ${getAmountClassName(isConsolidation, isReceive)}`}>
        <Amount
          sats={getAmountSats(tx, isConsolidation)}
          showSign={isReceive || isConsolidation}
          size="sm"
          className="justify-end"
        />
      </span>
    </ClickableCell>
  );
}

export function TransactionBalanceCell({
  highlightClass,
  onTxClick,
  tx,
  walletBalance,
}: TransactionCellProps & { walletBalance: number | undefined }) {
  if (walletBalance === undefined) return null;

  return (
    <ClickableCell
      className="px-4 py-3 whitespace-nowrap text-right"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        <Amount sats={tx.balanceAfter ?? 0} size="sm" className="justify-end" />
      </span>
    </ClickableCell>
  );
}

export function TransactionConfirmationsCell({
  confirmationThreshold,
  deepConfirmationThreshold,
  highlightClass,
  onTxClick,
  tx,
}: TransactionCellProps & { confirmationThreshold: number; deepConfirmationThreshold: number }) {
  return (
    <ClickableCell
      className="px-4 py-3 whitespace-nowrap text-center"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      <span
        className="inline-flex items-center text-sm font-medium"
        title={getConfirmationTitle(tx.confirmations)}
      >
        <ConfirmationStatus
          confirmationThreshold={confirmationThreshold}
          confirmations={tx.confirmations}
          deepConfirmationThreshold={deepConfirmationThreshold}
        />
      </span>
    </ClickableCell>
  );
}

export function TransactionLabelsCell({ highlightClass, onTxClick, tx }: TransactionCellProps) {
  return (
    <ClickableCell
      className="px-4 py-3"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      {tx.labels && tx.labels.length > 0 ? (
        <LabelBadges labels={tx.labels} maxDisplay={2} size="sm" />
      ) : tx.label ? (
        <span className="inline-flex items-center surface-secondary px-1.5 py-0.5 rounded text-xs text-sanctuary-600 dark:text-sanctuary-300">
          <Tag className="w-2.5 h-2.5 mr-1" />
          {tx.label}
        </span>
      ) : (
        <span className="text-sanctuary-300 dark:text-sanctuary-600">-</span>
      )}
    </ClickableCell>
  );
}

export function TransactionWalletBadgeCell({
  highlightClass,
  onTxClick,
  onWalletClick,
  showWalletBadge,
  tx,
  txWallet,
}: TransactionCellProps & {
  onWalletClick?: (walletId: string) => void;
  showWalletBadge: boolean;
  txWallet: Wallet | undefined;
}) {
  if (!showWalletBadge) return null;

  return (
    <ClickableCell
      className="px-4 py-3 whitespace-nowrap"
      highlightClass={highlightClass}
      onTxClick={onTxClick}
      tx={tx}
    >
      {txWallet && (
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${getWalletBadgeClass(txWallet)} ${onWalletClick ? 'cursor-pointer hover:opacity-80' : ''}`}
          onClick={(event) => {
            if (onWalletClick) {
              event.stopPropagation();
              onWalletClick(tx.walletId);
            }
          }}
        >
          {txWallet.name}
        </span>
      )}
    </ClickableCell>
  );
}

import { Check, Clock, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Transfer } from '../../types';
import { formatTimeAgo } from './transferTimeUtils';

export type TransferCardVariant = 'incoming' | 'awaiting_confirmation' | 'outgoing';

interface TransferCardVariantConfig {
  borderClass: string;
  iconBgClass: string;
  Icon: LucideIcon;
  title: string;
}

interface TransferDirectionLabels {
  leftLabel: string | undefined;
  rightLabel: string | undefined;
  leftClassName?: string;
  rightClassName?: string;
}

export const TRANSFER_CARD_VARIANTS: Record<TransferCardVariant, TransferCardVariantConfig> = {
  incoming: {
    borderClass: 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10',
    iconBgClass: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    Icon: Inbox,
    title: 'Incoming Transfer Request',
  },
  awaiting_confirmation: {
    borderClass: 'border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10',
    iconBgClass: 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
    Icon: Check,
    title: 'Ready to Confirm',
  },
  outgoing: {
    borderClass: 'border-sanctuary-200 dark:border-sanctuary-700',
    iconBgClass: 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500 dark:text-sanctuary-400',
    Icon: Clock,
    title: 'Awaiting Response',
  },
};

export function getTransferDirectionLabels(
  transfer: Transfer,
  variant: TransferCardVariant,
): TransferDirectionLabels {
  if (variant === 'incoming') {
    return {
      leftLabel: transfer.fromUser?.username,
      rightLabel: 'You',
      leftClassName: 'font-medium',
    };
  }

  return {
    leftLabel: 'You',
    rightLabel: transfer.toUser?.username,
    rightClassName: 'font-medium',
  };
}

export function getTransferTimestamp(transfer: Transfer, variant: TransferCardVariant): string {
  if (variant === 'incoming') {
    return formatTimeAgo(transfer.createdAt);
  }

  if (variant === 'awaiting_confirmation') {
    return `Accepted ${formatTimeAgo(transfer.acceptedAt || transfer.updatedAt)}`;
  }

  return `Initiated ${formatTimeAgo(transfer.createdAt)}`;
}

export function shouldShowTransferMessage(
  transfer: Transfer,
  variant: TransferCardVariant,
): boolean {
  return (variant === 'incoming' || variant === 'outgoing') && Boolean(transfer.message);
}

export function getAcceptedTransferMessage(transfer: Transfer): string {
  return `${transfer.toUser?.username} accepted the transfer. Confirm to complete.`;
}

/**
 * TransferCard Component
 *
 * Renders a single transfer card for incoming, outgoing, or awaiting-confirmation transfers.
 * Replaces three near-identical JSX blocks with a single variant-driven component.
 */

import React from 'react';
import { ArrowRight, Check, X, Clock, Send, Inbox } from 'lucide-react';
import { Button } from '../ui/Button';
import type { Transfer } from '../../types';
import { formatTimeAgo, formatExpiry } from './transferTimeUtils';
import type { TransferAction } from './useTransferActions';

interface TransferCardProps {
  transfer: Transfer;
  variant: 'incoming' | 'awaiting_confirmation' | 'outgoing';
  actionLoading: string | null;
  onAction: (transferId: string, action: TransferAction) => void;
}

const VARIANT_CONFIG = {
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
} as const;

export const TransferCard: React.FC<TransferCardProps> = ({
  transfer,
  variant,
  actionLoading,
  onAction,
}) => {
  const config = VARIANT_CONFIG[variant];
  const isLoading = actionLoading === transfer.id;

  const isOutbound = variant === 'outgoing' || variant === 'awaiting_confirmation';
  const leftLabel = isOutbound ? 'You' : transfer.fromUser?.username;
  const rightLabel = isOutbound ? transfer.toUser?.username : 'You';
  const leftBold = !isOutbound;
  const rightBold = isOutbound;

  const getTimestamp = (): string => {
    if (variant === 'incoming') {
      return formatTimeAgo(transfer.createdAt);
    }
    if (variant === 'awaiting_confirmation') {
      return `Accepted ${formatTimeAgo(transfer.acceptedAt || transfer.updatedAt)}`;
    }
    return `Initiated ${formatTimeAgo(transfer.createdAt)}`;
  };

  return (
    <div
      className={`surface-elevated rounded-lg p-4 border ${config.borderClass}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start">
          <div className={`p-2 ${config.iconBgClass} rounded-lg mr-3`}>
            <config.Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {config.title}
            </p>
            <div className="flex items-center text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-1">
              <span className={leftBold ? 'font-medium' : undefined}>{leftLabel}</span>
              <ArrowRight className="w-4 h-4 mx-1" />
              <span className={rightBold ? 'font-medium' : undefined}>{rightLabel}</span>
            </div>

            {(variant === 'incoming' || variant === 'outgoing') && transfer.message && (
              <p className="text-sm text-sanctuary-500 mt-2">"{transfer.message}"</p>
            )}
            {variant === 'awaiting_confirmation' && (
              <p className="text-xs text-primary-600 dark:text-primary-400 mt-2">
                {transfer.toUser?.username} accepted the transfer. Confirm to complete.
              </p>
            )}

            <div className="flex items-center text-xs text-sanctuary-400 mt-2 space-x-3">
              <span>{getTimestamp()}</span>
              <span className="flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {formatExpiry(transfer.expiresAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex space-x-2">
          {variant === 'incoming' && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onAction(transfer.id, 'decline')}
                disabled={isLoading}
              >
                <X className="w-4 h-4 mr-1" />
                Decline
              </Button>
              <Button
                size="sm"
                onClick={() => onAction(transfer.id, 'accept')}
                disabled={isLoading}
                isLoading={isLoading}
              >
                <Check className="w-4 h-4 mr-1" />
                Accept
              </Button>
            </>
          )}
          {variant === 'awaiting_confirmation' && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onAction(transfer.id, 'cancel')}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => onAction(transfer.id, 'confirm')}
                disabled={isLoading}
                isLoading={isLoading}
              >
                <Send className="w-4 h-4 mr-1" />
                Confirm Transfer
              </Button>
            </>
          )}
          {variant === 'outgoing' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAction(transfer.id, 'cancel')}
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

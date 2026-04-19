import { Check, Send, X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { TransferCardVariant } from './transferCardData';
import type { TransferAction } from './useTransferActions';

interface TransferActionProps {
  transferId: string;
  isLoading: boolean;
  onAction: (transferId: string, action: TransferAction) => void;
}

interface TransferCardActionsProps extends TransferActionProps {
  variant: TransferCardVariant;
}

function IncomingTransferActions({ transferId, isLoading, onAction }: TransferActionProps) {
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction(transferId, 'decline')}
        disabled={isLoading}
      >
        <X className="w-4 h-4 mr-1" />
        Decline
      </Button>
      <Button
        size="sm"
        onClick={() => onAction(transferId, 'accept')}
        disabled={isLoading}
        isLoading={isLoading}
      >
        <Check className="w-4 h-4 mr-1" />
        Accept
      </Button>
    </>
  );
}

function AwaitingConfirmationActions({ transferId, isLoading, onAction }: TransferActionProps) {
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction(transferId, 'cancel')}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => onAction(transferId, 'confirm')}
        disabled={isLoading}
        isLoading={isLoading}
      >
        <Send className="w-4 h-4 mr-1" />
        Confirm Transfer
      </Button>
    </>
  );
}

function OutgoingTransferActions({ transferId, isLoading, onAction }: TransferActionProps) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => onAction(transferId, 'cancel')}
      disabled={isLoading}
    >
      Cancel
    </Button>
  );
}

export function TransferCardActions({
  transferId,
  variant,
  isLoading,
  onAction,
}: TransferCardActionsProps) {
  if (variant === 'incoming') {
    return (
      <IncomingTransferActions
        transferId={transferId}
        isLoading={isLoading}
        onAction={onAction}
      />
    );
  }

  if (variant === 'awaiting_confirmation') {
    return (
      <AwaitingConfirmationActions
        transferId={transferId}
        isLoading={isLoading}
        onAction={onAction}
      />
    );
  }

  return (
    <OutgoingTransferActions
      transferId={transferId}
      isLoading={isLoading}
      onAction={onAction}
    />
  );
}

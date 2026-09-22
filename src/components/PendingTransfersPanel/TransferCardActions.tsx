import { Check, Send, X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { TransferCardVariant } from './transferCardData';
import type { TransferAction } from './useTransferActions';

interface TransferActionProps {
  transferId: string;
  isLoading: boolean;
  disabled: boolean;
  onAction: (transferId: string, action: TransferAction) => void;
}

interface TransferCardActionsProps extends TransferActionProps {
  variant: TransferCardVariant;
}

function IncomingTransferActions({ transferId, isLoading, disabled, onAction }: TransferActionProps) {
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction(transferId, 'decline')}
        disabled={disabled}
      >
        <X className="w-4 h-4 mr-1" />
        Decline
      </Button>
      <Button
        size="sm"
        onClick={() => onAction(transferId, 'accept')}
        disabled={disabled}
        isLoading={isLoading}
      >
        <Check className="w-4 h-4 mr-1" />
        Accept
      </Button>
    </>
  );
}

function AwaitingConfirmationActions({ transferId, isLoading, disabled, onAction }: TransferActionProps) {
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction(transferId, 'cancel')}
        disabled={disabled}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => onAction(transferId, 'confirm')}
        disabled={disabled}
        isLoading={isLoading}
      >
        <Send className="w-4 h-4 mr-1" />
        Confirm Transfer
      </Button>
    </>
  );
}

function OutgoingTransferActions({ transferId, disabled, onAction }: TransferActionProps) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => onAction(transferId, 'cancel')}
      disabled={disabled}
    >
      Cancel
    </Button>
  );
}

export function TransferCardActions({
  transferId,
  variant,
  isLoading,
  disabled,
  onAction,
}: TransferCardActionsProps) {
  if (variant === 'incoming') {
    return (
      <IncomingTransferActions
        transferId={transferId}
        isLoading={isLoading}
        disabled={disabled}
        onAction={onAction}
      />
    );
  }

  if (variant === 'awaiting_confirmation') {
    return (
      <AwaitingConfirmationActions
        transferId={transferId}
        isLoading={isLoading}
        disabled={disabled}
        onAction={onAction}
      />
    );
  }

  return (
    <OutgoingTransferActions
      transferId={transferId}
      isLoading={isLoading}
      disabled={disabled}
      onAction={onAction}
    />
  );
}

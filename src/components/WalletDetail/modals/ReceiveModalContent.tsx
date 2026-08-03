import React from 'react';
import { ReceiveAddressPanel } from './ReceiveAddressPanel';
import { ReceiveEmptyState } from './ReceiveEmptyState';
import { ReceiveLoadingState } from './ReceiveLoadingState';
import type { useReceiveModalState } from './useReceiveModalState';

type ReceiveModalState = ReturnType<typeof useReceiveModalState>;

interface ReceiveModalContentProps {
  walletId: string;
  receive: ReceiveModalState;
}

export const ReceiveModalContent: React.FC<ReceiveModalContentProps> = ({
  walletId,
  receive,
}) => {
  if (receive.receiveAddress) {
    return (
      <ReceiveAddressPanel
        walletId={walletId}
        selectedReceiveAddress={receive.selectedReceiveAddress}
        unusedReceiveAddresses={receive.unusedReceiveAddresses}
        displayValue={receive.displayValue}
        payjoinAvailable={receive.payjoinAvailable}
        payjoinEnabled={receive.payjoinEnabled}
        payjoinLoading={receive.payjoinLoading}
        receiveAmount={receive.receiveAmount}
        isCopied={receive.isCopied}
        onSelectAddress={receive.setSelectedReceiveAddressId}
        onPayjoinEnabledChange={receive.setPayjoinEnabled}
        onReceiveAmountChange={receive.setReceiveAmount}
        onCopy={receive.handleCopy}
      />
    );
  }

  if (receive.fetchingAddress) return <ReceiveLoadingState />;

  return <ReceiveEmptyState onNavigateToSettings={receive.handleNavigateToSettings} />;
};

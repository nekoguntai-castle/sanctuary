import React from 'react';
import type { Address } from '../../../types';
import { PayjoinSection } from '../../PayjoinSection';
import { ReceiveAddressSelector } from './ReceiveAddressSelector';
import { ReceiveAmountInput } from './ReceiveAmountInput';
import { ReceiveQrCode } from './ReceiveQrCode';
import { ReceiveValueBox } from './ReceiveValueBox';

interface ReceiveAddressPanelProps {
  walletId: string;
  selectedReceiveAddress: Address | undefined;
  unusedReceiveAddresses: Address[];
  displayValue: string;
  payjoinAvailable: boolean;
  payjoinEnabled: boolean;
  payjoinLoading: boolean;
  receiveAmount: string;
  isCopied: (value: string) => boolean;
  onSelectAddress: (addressId: string | null) => void;
  onPayjoinEnabledChange: (enabled: boolean) => void;
  onReceiveAmountChange: (receiveAmount: string) => void;
  onCopy: () => void;
}

export const ReceiveAddressPanel: React.FC<ReceiveAddressPanelProps> = ({
  walletId,
  selectedReceiveAddress,
  unusedReceiveAddresses,
  displayValue,
  payjoinAvailable,
  payjoinEnabled,
  payjoinLoading,
  receiveAmount,
  isCopied,
  onSelectAddress,
  onPayjoinEnabledChange,
  onReceiveAmountChange,
  onCopy,
}) => (
  <div className="flex flex-col items-center">
    <ReceiveQrCode value={displayValue} loading={payjoinLoading} />

    <ReceiveAddressSelector
      selectedAddress={selectedReceiveAddress}
      unusedReceiveAddresses={unusedReceiveAddresses}
      onSelectAddress={onSelectAddress}
    />

    {payjoinAvailable && (
      <PayjoinSection
        walletId={walletId}
        enabled={payjoinEnabled}
        onToggle={onPayjoinEnabledChange}
        className="w-full mb-4"
      />
    )}

    {payjoinAvailable && payjoinEnabled && (
      <ReceiveAmountInput
        receiveAmount={receiveAmount}
        onReceiveAmountChange={onReceiveAmountChange}
      />
    )}

    <ReceiveValueBox
      displayValue={displayValue}
      payjoinEnabled={payjoinEnabled}
      isCopied={isCopied}
      onCopy={onCopy}
    />
  </div>
);

/**
 * Recipients Section
 *
 * Renders the list of output rows and the add-recipient button.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../../../ui/Button';
import { OutputRow } from '../../../OutputRow';
import type { OutputEntry, TransactionType, WalletAddress } from '../../../../../contexts/send/types';

interface RecipientsSectionProps {
  outputs: OutputEntry[];
  outputsValid: (boolean | null)[];
  outputValidationMessages: (string | null)[];
  transactionType: TransactionType | null;
  scanningOutputIndex: number | null;
  payjoinUrl: string | null;
  payjoinStatus: 'idle' | 'attempting' | 'success' | 'failed';
  walletAddresses: WalletAddress[];
  unit: string;
  onAddressChange: (index: number, value: string) => void;
  onAmountChange: (index: number, displayValue: string, satsValue: string) => void;
  onAmountBlur: (index: number) => void;
  onRemove: (index: number) => void;
  onToggleSendMax: (index: number) => void;
  onScanQR: (index: number) => void;
  onAddOutput: () => void;
  getDisplayValue: (output: OutputEntry) => string;
  calculateMaxForOutput: (index: number) => number;
  formatDisplayValue: (sats: number) => string;
}

export const RecipientsSection: React.FC<RecipientsSectionProps> = ({
  outputs,
  outputsValid,
  outputValidationMessages,
  transactionType,
  scanningOutputIndex,
  payjoinUrl,
  payjoinStatus,
  walletAddresses,
  unit,
  onAddressChange,
  onAmountChange,
  onAmountBlur,
  onRemove,
  onToggleSendMax,
  onScanQR,
  onAddOutput,
  getDisplayValue,
  calculateMaxForOutput,
  formatDisplayValue,
}) => {
  const isConsolidation = transactionType === 'consolidation';

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        {isConsolidation ? 'Destination' : outputs.length > 1 ? `Recipients (${outputs.length})` : 'Recipient'}
      </h3>

      {outputs.map((output, index) => (
        <OutputRow
          key={index}
          output={output}
          index={index}
          totalOutputs={outputs.length}
          isValid={outputsValid[index]}
          validationMessage={outputValidationMessages[index] ?? null}
          onAddressChange={onAddressChange}
          onAmountChange={onAmountChange}
          onAmountBlur={onAmountBlur}
          onRemove={onRemove}
          onToggleSendMax={onToggleSendMax}
          onScanQR={onScanQR}
          isConsolidation={isConsolidation}
          walletAddresses={walletAddresses}
          disabled={false}
          showScanner={scanningOutputIndex === index}
          scanningOutputIndex={scanningOutputIndex}
          payjoinUrl={payjoinUrl}
          payjoinStatus={payjoinStatus}
          unit={unit}
          unitLabel={unit === 'btc' ? 'BTC' : 'sats'}
          displayValue={getDisplayValue(output)}
          maxAmount={calculateMaxForOutput(index)}
          formatAmount={formatDisplayValue}
          fiatAmount={output.sendMax ? calculateMaxForOutput(index) : parseInt(output.amount, 10) || 0}
        />
      ))}

      {/* Add Output Button */}
      {transactionType === 'standard' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddOutput}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Recipient
        </Button>
      )}
    </div>
  );
};

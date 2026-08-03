/**
 * Recipients Section
 *
 * Renders the list of output rows and the add-recipient button.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../../../ui/Button';
import { OutputRow } from '../../../OutputRow';
import type {
  OutputEntry,
  PayjoinAttemptStatus,
  TransactionType,
  WalletAddress,
} from '../../../../../contexts/send/types';

interface RecipientsSectionProps {
  outputs: OutputEntry[];
  outputsValid: (boolean | null)[];
  outputValidationMessages: (string | null)[];
  transactionType: TransactionType | null;
  scanningOutputIndex: number | null;
  payjoinUrl: string | null;
  payjoinStatus: PayjoinAttemptStatus;
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

const getRecipientTitle = (isConsolidation: boolean, outputCount: number): string => {
  if (isConsolidation) {
    return 'Destination';
  }

  return outputCount > 1 ? `Recipients (${outputCount})` : 'Recipient';
};

const getUnitLabel = (unit: string): string => unit === 'btc' ? 'BTC' : 'sats';

const getOutputFiatAmount = (output: OutputEntry, maxAmount: number): number =>
  output.sendMax ? maxAmount : parseInt(output.amount, 10) || 0;

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
  const unitLabel = getUnitLabel(unit);
  const showAddRecipient = transactionType === 'standard';

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        {getRecipientTitle(isConsolidation, outputs.length)}
      </h3>

      {outputs.map((output, index) => {
        const maxAmount = calculateMaxForOutput(index);

        return (
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
            unitLabel={unitLabel}
            displayValue={getDisplayValue(output)}
            maxAmount={maxAmount}
            formatAmount={formatDisplayValue}
            fiatAmount={getOutputFiatAmount(output, maxAmount)}
          />
        );
      })}

      {showAddRecipient && (
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

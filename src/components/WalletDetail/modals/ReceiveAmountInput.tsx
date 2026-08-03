import React from 'react';

interface ReceiveAmountInputProps {
  receiveAmount: string;
  onReceiveAmountChange: (receiveAmount: string) => void;
}

export const ReceiveAmountInput: React.FC<ReceiveAmountInputProps> = ({
  receiveAmount,
  onReceiveAmountChange,
}) => (
  <div className="w-full mb-4">
    <label className="block text-xs font-medium text-sanctuary-500 mb-1">
      Amount (optional)
    </label>
    <div className="flex items-center space-x-2">
      <input
        type="number"
        step="0.00000001"
        min="0"
        value={receiveAmount}
        onChange={(event) => onReceiveAmountChange(event.target.value)}
        placeholder="0.00000000"
        className="flex-1 px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 surface-muted text-sm font-mono"
      />
      <span className="text-sm text-sanctuary-500">BTC</span>
    </div>
  </div>
);

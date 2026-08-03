import React from 'react';
import { Check, Copy } from 'lucide-react';
import {
  getReceiveHelpText,
  getReceiveValueLabel,
} from './receiveModalData';

interface ReceiveValueBoxProps {
  displayValue: string;
  payjoinEnabled: boolean;
  isCopied: (value: string) => boolean;
  onCopy: () => void;
}

export const ReceiveValueBox: React.FC<ReceiveValueBoxProps> = ({
  displayValue,
  payjoinEnabled,
  isCopied,
  onCopy,
}) => {
  const copied = isCopied(displayValue);

  return (
    <>
      <div className="w-full">
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">
          {getReceiveValueLabel(payjoinEnabled)}
        </label>
        <div className="flex items-center space-x-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg p-3">
          <code className="text-xs font-mono text-sanctuary-700 dark:text-sanctuary-300 break-all flex-1">
            {displayValue}
          </code>
          <button
            onClick={onCopy}
            className={`flex-shrink-0 p-2 rounded transition-colors ${
              copied
                ? 'bg-success-100 dark:bg-success-500/20 text-success-600 dark:text-success-400'
                : 'hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 text-sanctuary-400'
            }`}
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-sanctuary-500 mt-4 text-center">
        {getReceiveHelpText(payjoinEnabled)}
      </p>
    </>
  );
};

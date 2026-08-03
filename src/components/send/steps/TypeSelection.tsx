/**
 * TypeSelection Step
 *
 * First step of the transaction wizard.
 * Allows user to select between Standard, Consolidation, or Sweep transaction types.
 */

import React from 'react';
import { Send, Layers, Zap } from 'lucide-react';
import { useSendTransaction } from '../../../contexts/send';
import type { TransactionType } from '../../../contexts/send/types';

interface TransactionTypeOption {
  type: TransactionType;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const TRANSACTION_TYPES: TransactionTypeOption[] = [
  {
    type: 'standard',
    icon: <Send className="w-6 h-6" />,
    title: 'Standard Send',
    description: 'Send Bitcoin to one or more addresses with manual amount control.',
  },
  {
    type: 'consolidation',
    icon: <Layers className="w-6 h-6" />,
    title: 'Consolidation',
    description: 'Combine multiple UTXOs into a single output to your own wallet.',
  },
  {
    type: 'sweep',
    icon: <Zap className="w-6 h-6" />,
    title: 'Sweep',
    description: 'Send all funds to a single address, emptying the wallet.',
  },
];

export function TypeSelection() {
  const { state, setTransactionType, nextStep } = useSendTransaction();

  const handleSelect = (type: TransactionType) => {
    setTransactionType(type);
    // Auto-advance to next step after selection
    setTimeout(() => nextStep(), 150);
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          What would you like to do?
        </h2>
        <p className="text-sm text-sanctuary-500 mt-2">
          Select a transaction type to get started
        </p>
      </div>

      <div className="grid gap-4">
        {TRANSACTION_TYPES.map((option) => (
          <button
            key={option.type}
            type="button"
            onClick={() => handleSelect(option.type)}
            className={`
              w-full p-5 rounded-lg border-2 text-left transition-all
              hover:scale-[1.01] hover:shadow-md
              ${state.transactionType === option.type
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300 dark:hover:border-primary-700'
              }
            `}
          >
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div
                className={`
                  p-3 rounded-lg
                  ${state.transactionType === option.type
                    ? 'bg-primary-500 text-white'
                    : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
                  }
                `}
              >
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3
                  className={`
                    font-semibold
                    ${state.transactionType === option.type
                      ? 'text-primary-700 dark:text-primary-300'
                      : 'text-sanctuary-900 dark:text-sanctuary-100'
                    }
                  `}
                >
                  {option.title}
                </h3>
                <p className="text-sm text-sanctuary-500 mt-1">
                  {option.description}
                </p>
              </div>

              {/* Selection indicator */}
              <div
                className={`
                  w-5 h-5 rounded-full border-2 flex items-center justify-center
                  ${state.transactionType === option.type
                    ? 'border-primary-500 bg-primary-500'
                    : 'border-sanctuary-300 dark:border-sanctuary-600'
                  }
                `}
              >
                {state.transactionType === option.type && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

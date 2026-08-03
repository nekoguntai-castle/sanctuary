import React from 'react';
import { X } from 'lucide-react';
import type { AddAccountMethod } from '../types';

interface AddAccountModalChromeProps {
  addAccountMethod: AddAccountMethod;
  addAccountLoading: boolean;
  addAccountError: string | null;
  onClose: () => void;
  onBack: () => void;
  children: React.ReactNode;
}

export const AddAccountModalChrome: React.FC<AddAccountModalChromeProps> = ({
  addAccountMethod,
  addAccountLoading,
  addAccountError,
  onClose,
  onBack,
  children,
}) => (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-xl">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">
            Add Derivation Path
          </h3>
          <button
            onClick={onClose}
            className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {children}

        {addAccountError && (
          <p className="mt-4 text-center text-sm text-rose-600 dark:text-rose-400">
            {addAccountError}
          </p>
        )}

        {addAccountMethod && !addAccountLoading && (
          <button
            onClick={onBack}
            className="mt-4 w-full text-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
          >
            &larr; Back to options
          </button>
        )}
      </div>
    </div>
  </div>
);

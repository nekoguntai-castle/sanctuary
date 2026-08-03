import React from 'react';
import { UserPlus, X } from 'lucide-react';

interface TransferOwnershipHeaderProps {
  resourceLabel: string;
  resourceName: string;
  onClose: () => void;
}

export const TransferOwnershipHeader: React.FC<TransferOwnershipHeaderProps> = ({
  resourceLabel,
  resourceName,
  onClose,
}) => (
  <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
          <UserPlus className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Transfer Ownership
          </h3>
          <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-0.5">
            {resourceLabel}: {resourceName}
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 p-1 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  </div>
);

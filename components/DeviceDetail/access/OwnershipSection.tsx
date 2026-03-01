import React from 'react';
import { Send } from 'lucide-react';
import type { DeviceShareInfo } from '../../../types';

interface OwnershipSectionProps {
  deviceShareInfo: DeviceShareInfo | null;
  username: string | undefined;
  isOwner: boolean;
  onTransfer: () => void;
}

export const OwnershipSection: React.FC<OwnershipSectionProps> = ({
  deviceShareInfo,
  username,
  isOwner,
  onTransfer,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
        <div className="flex items-center">
          <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
            {deviceShareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || username?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="ml-3">
            <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {deviceShareInfo?.users.find(u => u.role === 'owner')?.username || username || 'You'}
            </p>
            <p className="text-xs text-sanctuary-500">Device Owner</p>
          </div>
        </div>
        {isOwner && (
          <button
            onClick={onTransfer}
            className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Transfer
          </button>
        )}
      </div>
    </div>
  );
};

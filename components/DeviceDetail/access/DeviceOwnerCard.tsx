import React from 'react';
import { Send } from 'lucide-react';
import type { OwnerDisplay } from './accessSectionData';

interface DeviceOwnerCardProps {
  owner: OwnerDisplay;
  isOwner: boolean;
  onTransfer: () => void;
}

export const DeviceOwnerCard: React.FC<DeviceOwnerCardProps> = ({
  owner,
  isOwner,
  onTransfer,
}) => (
  <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
    <div className="flex items-center">
      <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
        {owner.initial}
      </div>
      <div className="ml-3">
        <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
          {owner.username}
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
);

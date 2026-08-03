/**
 * ConflictDialog Component
 *
 * Modal dialog for handling device conflicts when a device with the same
 * fingerprint already exists. Shows comparison and merge options.
 */

import React from 'react';
import { ConflictDialogProps } from './types';
import { AccountComparisonSections } from './ConflictDialog/AccountComparisonSections';
import { ConflictDialogActions } from './ConflictDialog/ConflictDialogActions';
import { ConflictDialogHeader } from './ConflictDialog/ConflictDialogHeader';
import { ExistingDeviceSummary } from './ConflictDialog/ExistingDeviceSummary';

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  conflictData,
  merging,
  error,
  onMerge,
  onViewExisting,
  onCancel,
}) => (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
      <div className="p-6">
        <ConflictDialogHeader fingerprint={conflictData.existingDevice.fingerprint} />
        <ExistingDeviceSummary device={conflictData.existingDevice} />
        <AccountComparisonSections comparison={conflictData.comparison} />
        <ConflictDialogActions
          comparison={conflictData.comparison}
          merging={merging}
          error={error}
          onMerge={onMerge}
          onViewExisting={onViewExisting}
          onCancel={onCancel}
        />
      </div>
    </div>
  </div>
);

/**
 * GeneralSettings - Wallet name editing and label management
 */

import React from 'react';
import { Check, X, Edit2 } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { LabelManager } from '../../../LabelManager';
import type { Wallet } from '../../../../types';
import { canEditWallet } from '../../../../utils/walletCapabilities';

interface GeneralSettingsProps {
  wallet: Wallet;
  isEditingName: boolean;
  editedName: string;
  onSetIsEditingName: (editing: boolean) => void;
  onSetEditedName: (name: string) => void;
  onUpdateWallet: (data: { name: string }) => void;
  onLabelsChange: () => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  wallet,
  isEditingName,
  editedName,
  onSetIsEditingName,
  onSetEditedName,
  onUpdateWallet,
  onLabelsChange,
}) => (
  <div className="space-y-4">
    {/* Wallet Name */}
    <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
      <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Wallet Name</h3>
      {isEditingName ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editedName}
            onChange={(e) => onSetEditedName(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-sanctuary-300 dark:border-sanctuary-600 rounded-md bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Enter wallet name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editedName.trim()) {
                onUpdateWallet({ name: editedName.trim() });
                onSetIsEditingName(false);
              } else if (e.key === 'Escape') {
                onSetIsEditingName(false);
                onSetEditedName(wallet.name);
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (editedName.trim()) {
                onUpdateWallet({ name: editedName.trim() });
                onSetIsEditingName(false);
              }
            }}
            disabled={!editedName.trim() || editedName.trim() === wallet.name}
          >
            <Check className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onSetIsEditingName(false);
              onSetEditedName(wallet.name);
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{wallet.name}</span>
          {canEditWallet(wallet) && (
            <button
              onClick={() => {
                onSetEditedName(wallet.name);
                onSetIsEditingName(true);
              }}
              className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700"
              title="Rename wallet"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>

    {/* Labels Management - only show if user can edit */}
    {canEditWallet(wallet) && (
      <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
        <LabelManager walletId={wallet.id} onLabelsChange={onLabelsChange} />
      </div>
    )}
  </div>
);

/**
 * SettingsTab - Wallet settings with sub-tabs for general, devices, notifications, and advanced
 *
 * Thin orchestrator that delegates to extracted sub-tab components.
 */

import React from 'react';
import { WalletTelegramSettings } from '../WalletTelegramSettings';
import { WalletAutopilotSettings } from '../WalletAutopilotSettings';
import { WalletWebhooks } from '../WalletWebhooks';
import { SettingsSubTabs, GeneralSettings, DevicesSettings, AdvancedSettings } from './settings';
import type { Wallet, Device } from '../../../types';
import type { SettingsSubTab } from '../types';

interface SettingsTabProps {
  settingsSubTab: SettingsSubTab;
  onSettingsSubTabChange: (tab: SettingsSubTab) => void;
  wallet: Wallet;
  devices: Device[];
  isEditingName: boolean;
  editedName: string;
  onSetIsEditingName: (editing: boolean) => void;
  onSetEditedName: (name: string) => void;
  onUpdateWallet: (data: { name: string }) => void;
  onLabelsChange: () => void;
  syncing: boolean;
  onSync: () => void;
  onFullResync: () => void;
  onRemediationApplied?: () => Promise<void> | void;
  showDangerZone: boolean;
  onSetShowDangerZone: (show: boolean) => void;
  onShowDelete: () => void;
  onShowExport: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settingsSubTab,
  onSettingsSubTabChange,
  wallet,
  devices,
  isEditingName,
  editedName,
  onSetIsEditingName,
  onSetEditedName,
  onUpdateWallet,
  onLabelsChange,
  syncing,
  onSync,
  onFullResync,
  onRemediationApplied,
  showDangerZone,
  onSetShowDangerZone,
  onShowDelete,
  onShowExport,
}) => (
  <div className="max-w-2xl space-y-4">
    <SettingsSubTabs
      settingsSubTab={settingsSubTab}
      onSettingsSubTabChange={onSettingsSubTabChange}
    />

    {settingsSubTab === 'general' && (
      <GeneralSettings
        wallet={wallet}
        isEditingName={isEditingName}
        editedName={editedName}
        onSetIsEditingName={onSetIsEditingName}
        onSetEditedName={onSetEditedName}
        onUpdateWallet={onUpdateWallet}
        onLabelsChange={onLabelsChange}
      />
    )}

    {settingsSubTab === 'devices' && (
      <DevicesSettings wallet={wallet} devices={devices} />
    )}

    {settingsSubTab === 'notifications' && (
      <WalletTelegramSettings walletId={wallet.id} />
    )}

    {settingsSubTab === 'webhooks' && (
      <WalletWebhooks walletId={wallet.id} userRole={wallet.userRole} />
    )}

    {settingsSubTab === 'advanced' && (
      <AdvancedSettings
        wallet={wallet}
        syncing={syncing}
        onSync={onSync}
        onFullResync={onFullResync}
        onRemediationApplied={onRemediationApplied}
        showDangerZone={showDangerZone}
        onSetShowDangerZone={onSetShowDangerZone}
        onShowDelete={onShowDelete}
        onShowExport={onShowExport}
      />
    )}

    {settingsSubTab === 'autopilot' && (
      <WalletAutopilotSettings walletId={wallet.id} />
    )}
  </div>
);

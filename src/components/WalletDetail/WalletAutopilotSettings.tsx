/**
 * Wallet Autopilot Settings Component
 *
 * Per-wallet autopilot configuration for automated consolidation suggestions.
 * Follows the same pattern as WalletTelegramSettings.
 */

import React from 'react';
import { AutopilotHealthStatusCard } from './WalletAutopilotSettings/AutopilotHealthStatusCard';
import { AutopilotSettingsCard } from './WalletAutopilotSettings/AutopilotSettingsCard';
import { AutopilotLoadingCard, FeatureUnavailableCard } from './WalletAutopilotSettings/AutopilotStateCards';
import { useWalletAutopilotSettingsController } from './WalletAutopilotSettings/useWalletAutopilotSettingsController';

interface Props {
  walletId: string;
}

export const WalletAutopilotSettings: React.FC<Props> = ({ walletId }) => {
  const controller = useWalletAutopilotSettingsController(walletId);

  if (controller.loading) {
    return <AutopilotLoadingCard />;
  }

  if (controller.featureUnavailable) {
    return <FeatureUnavailableCard />;
  }

  return (
    <div className="space-y-4">
      <AutopilotSettingsCard
        settings={controller.settings}
        saving={controller.saving}
        success={controller.success}
        error={controller.error}
        notificationsAvailable={controller.notificationsAvailable}
        showAdvanced={controller.showAdvanced}
        onToggleAdvanced={() => controller.setShowAdvanced(!controller.showAdvanced)}
        onToggle={controller.handleToggle}
        onNumberChange={controller.handleNumberChange}
        onNumberBlur={controller.handleNumberBlur}
      />
      <AutopilotHealthStatusCard
        status={controller.status}
        visible={Boolean(controller.notificationsAvailable && controller.settings.enabled)}
      />
    </div>
  );
};

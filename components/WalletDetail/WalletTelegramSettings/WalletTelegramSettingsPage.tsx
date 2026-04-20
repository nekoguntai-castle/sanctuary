import { Send } from 'lucide-react';
import type { WalletTelegramSettingsController } from './types';
import { TelegramAvailabilityNotice } from './TelegramAvailabilityNotice';
import { WalletTelegramControls } from './WalletTelegramControls';
import { WalletTelegramLoadingCard } from './WalletTelegramLoadingCard';

interface WalletTelegramSettingsPageProps {
  controller: WalletTelegramSettingsController;
}

export function WalletTelegramSettingsPage({ controller }: WalletTelegramSettingsPageProps) {
  if (controller.loading) {
    return <WalletTelegramLoadingCard />;
  }

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Send className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Telegram Notifications</h3>
          {controller.success && (
            <span className="text-xs text-success-600 dark:text-success-400 ml-auto">Saved!</span>
          )}
        </div>
      </div>

      <div className="p-6">
        <WalletTelegramSettingsBody controller={controller} />
      </div>
    </div>
  );
}

function WalletTelegramSettingsBody({ controller }: WalletTelegramSettingsPageProps) {
  if (controller.availability !== 'available') {
    return <TelegramAvailabilityNotice availability={controller.availability} />;
  }

  return <WalletTelegramControls controller={controller} />;
}

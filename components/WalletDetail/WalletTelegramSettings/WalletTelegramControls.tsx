import { AlertCircle } from 'lucide-react';
import { Toggle } from '../../ui/Toggle';
import { NotificationToggleList } from './NotificationToggleList';
import type { WalletTelegramSettingsController } from './types';

interface WalletTelegramControlsProps {
  controller: WalletTelegramSettingsController;
}

export function WalletTelegramControls({ controller }: WalletTelegramControlsProps) {
  return (
    <div className="space-y-4">
      {controller.error && <WalletTelegramError message={controller.error} />}
      <WalletEnableToggle controller={controller} />
      {controller.settings.enabled && <NotificationToggleList controller={controller} />}
    </div>
  );
}

function WalletTelegramError({ message }: { message: string }) {
  return (
    <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center space-x-2">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm text-rose-600 dark:text-rose-400">{message}</span>
    </div>
  );
}

function WalletEnableToggle({ controller }: WalletTelegramControlsProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable for this wallet</p>
        <p className="text-xs text-sanctuary-500">Receive notifications for this wallet's transactions</p>
      </div>
      <Toggle
        checked={controller.settings.enabled}
        onChange={() => controller.handleToggle('enabled')}
        disabled={controller.saving}
        color="success"
      />
    </div>
  );
}

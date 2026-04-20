import { NOTIFICATION_TOGGLE_OPTIONS } from './settingsModel';
import type { NotificationToggleOption, WalletTelegramSettingsController } from './types';

interface NotificationToggleListProps {
  controller: WalletTelegramSettingsController;
}

export function NotificationToggleList({ controller }: NotificationToggleListProps) {
  return (
    <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-3">
      <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Notify me when:</p>
      {NOTIFICATION_TOGGLE_OPTIONS.map((option) => (
        <NotificationToggleOptionRow
          key={option.field}
          option={option}
          controller={controller}
        />
      ))}
    </div>
  );
}

interface NotificationToggleOptionRowProps extends NotificationToggleListProps {
  option: NotificationToggleOption;
}

function NotificationToggleOptionRow({ option, controller }: NotificationToggleOptionRowProps) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{option.label}</span>
      <input
        type="checkbox"
        checked={controller.settings[option.field]}
        onChange={() => controller.handleToggle(option.field)}
        disabled={controller.saving}
        className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
      />
    </label>
  );
}

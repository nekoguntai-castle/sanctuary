import type { WalletTelegramSettings as WalletTelegramSettingsType } from '../../../types';

export type WalletTelegramSettingKey = keyof WalletTelegramSettingsType;

export type TelegramAvailability = 'not-configured' | 'disabled' | 'available';

export interface NotificationToggleOption {
  field: WalletTelegramSettingKey;
  label: string;
}

export interface WalletTelegramSettingsController {
  loading: boolean;
  loadError: string | null;
  retryLoad: () => void;
  settings: WalletTelegramSettingsType;
  saving: boolean;
  error: string | null;
  success: boolean;
  availability: TelegramAvailability;
  handleToggle: (field: WalletTelegramSettingKey) => void;
}

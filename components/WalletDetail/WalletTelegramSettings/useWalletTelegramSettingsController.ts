import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WalletTelegramSettings as WalletTelegramSettingsType } from '../../../types';
import { useUser } from '../../../contexts/UserContext';
import * as walletsApi from '../../../src/api/wallets';
import { createLogger } from '../../../utils/logger';
import {
  DEFAULT_WALLET_TELEGRAM_SETTINGS,
  getTelegramAvailability,
  getWalletTelegramSaveErrorMessage,
} from './settingsModel';
import type { WalletTelegramSettingKey, WalletTelegramSettingsController } from './types';

const log = createLogger('WalletTelegramSettings');

export function useWalletTelegramSettingsController(walletId: string): WalletTelegramSettingsController {
  const { user } = useUser();
  const [settings, setSettings] = useState<WalletTelegramSettingsType>(DEFAULT_WALLET_TELEGRAM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => clearSuccessTimeoutOnUnmount(successTimeoutRef), []);

  useEffect(() => {
    let isMounted = true;

    const fetchSettings = async () => {
      try {
        const data = await walletsApi.getWalletTelegramSettings(walletId);
        if (isMounted) {
          setSettings(data);
        }
      } catch (err) {
        log.debug('Using default telegram settings', { error: err });
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchSettings();

    return () => {
      isMounted = false;
    };
  }, [walletId]);

  const handleToggle = useCallback((field: WalletTelegramSettingKey) => {
    const previousSettings = settings;
    const nextSettings = { ...settings, [field]: !settings[field] };

    void saveSettings({
      walletId,
      nextSettings,
      previousSettings,
      setSettings,
      setSaving,
      setError,
      setSuccess,
      successTimeoutRef,
    });
  }, [settings, walletId]);

  return {
    loading,
    settings,
    saving,
    error,
    success,
    availability: getTelegramAvailability(user),
    handleToggle,
  };
}

interface SaveSettingsArgs {
  walletId: string;
  nextSettings: WalletTelegramSettingsType;
  previousSettings: WalletTelegramSettingsType;
  setSettings: (settings: WalletTelegramSettingsType) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: boolean) => void;
  successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
}

async function saveSettings({
  walletId,
  nextSettings,
  previousSettings,
  setSettings,
  setSaving,
  setError,
  setSuccess,
  successTimeoutRef,
}: SaveSettingsArgs) {
  setSettings(nextSettings);
  setSaving(true);
  setError(null);

  try {
    await walletsApi.updateWalletTelegramSettings(walletId, nextSettings);
    showSaveSuccess(setSuccess, successTimeoutRef);
  } catch (err) {
    setSettings(previousSettings);
    setError(getWalletTelegramSaveErrorMessage(err));
  } finally {
    setSaving(false);
  }
}

function clearSuccessTimeoutOnUnmount(successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  return () => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
  };
}

function showSaveSuccess(
  setSuccess: (success: boolean) => void,
  successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
) {
  setSuccess(true);

  if (successTimeoutRef.current) {
    clearTimeout(successTimeoutRef.current);
  }

  successTimeoutRef.current = setTimeout(() => setSuccess(false), 2000);
}

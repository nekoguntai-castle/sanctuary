import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WalletTelegramSettings as WalletTelegramSettingsType } from '../../../types';
import { useUser } from '../../../contexts/UserContext';
import * as walletsApi from '../../../api/wallets';
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
  // Monotonically increasing marker for "which mount of the controller is
  // current". A ref keyed only on walletId cannot distinguish A -> B -> A:
  // switching back to the original wallet would make an old, still-pending
  // save for that same walletId look current again. Bumping this counter on
  // every walletId change (including a return to a previous wallet) gives
  // each save() call a token that is only ever current for the mount that
  // started it.
  const currentRequestIdRef = useRef(0);

  useEffect(() => clearSuccessTimeoutOnUnmount(successTimeoutRef), []);

  useEffect(() => {
    let isMounted = true;
    currentRequestIdRef.current += 1;

    // A wallet switch must not leave state (saving/error/success) from the
    // previous wallet's in-flight save visible against this wallet.
    setLoading(true);
    setSaving(false);
    setError(null);
    setSuccess(false);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }

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
      requestId: currentRequestIdRef.current,
      nextSettings,
      previousSettings,
      setSettings,
      setSaving,
      setError,
      setSuccess,
      successTimeoutRef,
      currentRequestIdRef,
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
  requestId: number;
  nextSettings: WalletTelegramSettingsType;
  previousSettings: WalletTelegramSettingsType;
  setSettings: (settings: WalletTelegramSettingsType) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: boolean) => void;
  successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  currentRequestIdRef: RefObject<number>;
}

async function saveSettings({
  walletId,
  requestId,
  nextSettings,
  previousSettings,
  setSettings,
  setSaving,
  setError,
  setSuccess,
  successTimeoutRef,
  currentRequestIdRef,
}: SaveSettingsArgs) {
  setSettings(nextSettings);
  setSaving(true);
  setError(null);

  const isStale = () => currentRequestIdRef.current !== requestId;

  try {
    await walletsApi.updateWalletTelegramSettings(walletId, nextSettings);
    if (isStale()) {
      return;
    }
    showSaveSuccess(setSuccess, successTimeoutRef);
  } catch (err) {
    if (isStale()) {
      log.debug('Ignoring stale telegram settings save rejection', { walletId, error: err });
      return;
    }
    setSettings(previousSettings);
    setError(getWalletTelegramSaveErrorMessage(err));
  } finally {
    if (!isStale()) {
      setSaving(false);
    }
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

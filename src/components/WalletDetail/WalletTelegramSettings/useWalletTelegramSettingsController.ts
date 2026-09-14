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
  // Monotonically increasing marker for "which save (or mount) is current".
  // Bumped both on every walletId change (so A -> B -> A cannot make a
  // still-pending save from the earlier A mount look current again) and on
  // every individual save, so an earlier save on the SAME mount becomes
  // stale the moment a later save starts, rather than only across mounts.
  const currentRequestIdRef = useRef(0);
  // Mirrors `settings` synchronously (state updates are batched/async), so
  // rapid toggles compute `nextSettings` from the latest optimistic value
  // rather than a stale render closure.
  const settingsRef = useRef<WalletTelegramSettingsType>(DEFAULT_WALLET_TELEGRAM_SETTINGS);
  // The last settings confirmed by the server (on load, and on each
  // non-stale successful save). A failed save reverts to this, not to the
  // toggle's captured pre-toggle snapshot, so an out-of-order failure can't
  // stomp a later save's already-committed change.
  const confirmedSettingsRef = useRef<WalletTelegramSettingsType>(DEFAULT_WALLET_TELEGRAM_SETTINGS);

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
    settingsRef.current = DEFAULT_WALLET_TELEGRAM_SETTINGS;
    confirmedSettingsRef.current = DEFAULT_WALLET_TELEGRAM_SETTINGS;
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }

    const fetchSettings = async () => {
      try {
        const data = await walletsApi.getWalletTelegramSettings(walletId);
        if (isMounted) {
          settingsRef.current = data;
          confirmedSettingsRef.current = data;
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
    // Read/write settingsRef (not the `settings` closure) so a second toggle
    // queued before the first re-render sees the first toggle's change.
    const nextSettings = { ...settingsRef.current, [field]: !settingsRef.current[field] };
    settingsRef.current = nextSettings;

    // Every save gets its own id: an earlier save on this same mount is
    // stale the instant a later one starts.
    currentRequestIdRef.current += 1;
    const requestId = currentRequestIdRef.current;

    void saveSettings({
      walletId,
      requestId,
      nextSettings,
      setSettings,
      setSaving,
      setError,
      setSuccess,
      successTimeoutRef,
      currentRequestIdRef,
      confirmedSettingsRef,
      settingsRef,
    });
  }, [walletId]);

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
  setSettings: (settings: WalletTelegramSettingsType) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: boolean) => void;
  successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  currentRequestIdRef: RefObject<number>;
  confirmedSettingsRef: RefObject<WalletTelegramSettingsType>;
  settingsRef: RefObject<WalletTelegramSettingsType>;
}

async function saveSettings({
  walletId,
  requestId,
  nextSettings,
  setSettings,
  setSaving,
  setError,
  setSuccess,
  successTimeoutRef,
  currentRequestIdRef,
  confirmedSettingsRef,
  settingsRef,
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
    confirmedSettingsRef.current = nextSettings;
    showSaveSuccess(setSuccess, successTimeoutRef);
  } catch (err) {
    if (isStale()) {
      log.debug('Ignoring stale telegram settings save rejection', { walletId, error: err });
      return;
    }
    settingsRef.current = confirmedSettingsRef.current;
    setSettings(confirmedSettingsRef.current);
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

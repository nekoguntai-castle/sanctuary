import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletAutopilotSettings as AutopilotSettingsType, AutopilotStatus } from '../../../types';
import { useUser } from '../../../contexts/UserContext';
import * as walletsApi from '../../../api/wallets';
import { ApiError } from '../../../api/client';
import { createLogger } from '../../../utils/logger';

const SETTINGS_LOAD_FAILED_MESSAGE = 'Failed to load autopilot settings. Refresh the page before making changes.';

const log = createLogger('WalletAutopilotSettings');

const DEFAULT_SETTINGS: AutopilotSettingsType = {
  enabled: false,
  maxFeeRate: 5,
  minUtxoCount: 10,
  dustThreshold: 10_000,
  cooldownHours: 24,
  notifyTelegram: true,
  notifyPush: true,
  minDustCount: 0,
  maxUtxoSize: 0,
};

type ToggleField = 'enabled' | 'notifyTelegram' | 'notifyPush';

function getNotificationsAvailable(user: ReturnType<typeof useUser>['user']) {
  const telegramConfigured = Boolean(
    user?.preferences?.telegram?.botToken && user?.preferences?.telegram?.chatId
  );
  const telegramEnabled = user?.preferences?.telegram?.enabled;
  return telegramConfigured && Boolean(telegramEnabled);
}

export function useWalletAutopilotSettingsController(walletId: string) {
  const { user } = useUser();
  const [settings, setSettings] = useState<AutopilotSettingsType>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const prevSettingsRef = useRef<AutopilotSettingsType>(DEFAULT_SETTINGS);
  // Whether the wallet's real settings are known: true only after a load for the
  // *current* walletId has resolved (success, or a definitive 404/403 meaning
  // there is nothing to load / no access). Starts false and is reset to false
  // whenever walletId changes, so saveSettings below can refuse to write while
  // the baseline is unknown instead of overwriting the server with
  // DEFAULT_SETTINGS.
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    settingsLoadedRef.current = false;

    const fetchData = async () => {
      try {
        const data = await walletsApi.getWalletAutopilotSettings(walletId);
        if (cancelled) return;
        setSettings(data);
        prevSettingsRef.current = data;
        settingsLoadedRef.current = true;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setFeatureUnavailable(true);
          settingsLoadedRef.current = true;
        } else {
          log.error('Failed to load autopilot settings', { error: err });
          setError(SETTINGS_LOAD_FAILED_MESSAGE);
        }
      }

      try {
        const statusData = await walletsApi.getWalletAutopilotStatus(walletId);
        if (!cancelled) setStatus(statusData);
      } catch (error) {
        log.debug('Optional autopilot status fetch failed', { error });
      }

      if (!cancelled) setLoading(false);
    };
    fetchData();

    return () => {
      cancelled = true;
    };
  }, [walletId]);

  const saveSettings = useCallback(async (newSettings: AutopilotSettingsType) => {
    if (!settingsLoadedRef.current) {
      setError(SETTINGS_LOAD_FAILED_MESSAGE);
      return;
    }

    const prev = prevSettingsRef.current;
    setSettings(newSettings);
    setSaving(true);
    setError(null);

    try {
      await walletsApi.updateWalletAutopilotSettings(walletId, newSettings);
      prevSettingsRef.current = newSettings;
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setSettings(prev);
      const message = err instanceof ApiError ? err.message : 'Failed to update settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [walletId]);

  const handleToggle = useCallback((field: ToggleField) => {
    const newSettings = { ...settings, [field]: !settings[field] };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  const handleNumberChange = useCallback((field: keyof AutopilotSettingsType, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setSettings(prev => ({ ...prev, [field]: num }));
  }, []);

  const handleNumberBlur = useCallback((field: keyof AutopilotSettingsType) => {
    if (settings[field] !== prevSettingsRef.current[field]) {
      saveSettings(settings);
    }
  }, [settings, saveSettings]);

  return {
    settings,
    status,
    loading,
    saving,
    error,
    success,
    featureUnavailable,
    showAdvanced,
    notificationsAvailable: getNotificationsAvailable(user),
    setShowAdvanced,
    handleToggle,
    handleNumberChange,
    handleNumberBlur,
  };
}

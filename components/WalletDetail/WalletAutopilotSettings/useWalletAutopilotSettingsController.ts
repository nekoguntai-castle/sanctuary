import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletAutopilotSettings as AutopilotSettingsType, AutopilotStatus } from '../../../types';
import { useUser } from '../../../contexts/UserContext';
import * as walletsApi from '../../../src/api/wallets';
import { ApiError } from '../../../src/api/client';
import { createLogger } from '../../../utils/logger';

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await walletsApi.getWalletAutopilotSettings(walletId);
        setSettings(data);
        prevSettingsRef.current = data;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setFeatureUnavailable(true);
        }
      }

      try {
        const statusData = await walletsApi.getWalletAutopilotStatus(walletId);
        setStatus(statusData);
      } catch (error) {
        log.debug('Optional autopilot status fetch failed', { error });
      }

      setLoading(false);
    };
    fetchData();
  }, [walletId]);

  const saveSettings = useCallback(async (newSettings: AutopilotSettingsType) => {
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

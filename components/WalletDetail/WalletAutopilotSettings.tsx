/**
 * Wallet Autopilot Settings Component
 *
 * Per-wallet autopilot configuration for automated consolidation suggestions.
 * Follows the same pattern as WalletTelegramSettings.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { WalletAutopilotSettings as AutopilotSettingsType, AutopilotStatus } from '../../types';
import * as walletsApi from '../../src/api/wallets';
import { ApiError } from '../../src/api/client';
import { useUser } from '../../contexts/UserContext';
import { Zap, AlertCircle, ChevronDown, Activity } from 'lucide-react';

interface Props {
  walletId: string;
}

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

function formatSats(value: string): string {
  const num = Number(value);
  if (num >= 100_000_000) {
    return `${(num / 100_000_000).toFixed(8)} BTC`;
  }
  return `${num.toLocaleString()} sats`;
}

export const WalletAutopilotSettings: React.FC<Props> = ({ walletId }) => {
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

  // Check if user has Telegram configured
  const telegramConfigured = Boolean(
    user?.preferences?.telegram?.botToken && user?.preferences?.telegram?.chatId
  );
  const telegramEnabled = user?.preferences?.telegram?.enabled;
  const notificationsAvailable = telegramConfigured && telegramEnabled;

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
        // Use defaults if not configured
      }

      try {
        const statusData = await walletsApi.getWalletAutopilotStatus(walletId);
        setStatus(statusData);
      } catch {
        // Status fetch is optional
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

  const handleToggle = useCallback((field: 'enabled' | 'notifyTelegram' | 'notifyPush') => {
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

  if (loading) {
    return (
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="animate-pulse flex space-x-4">
          <div className="h-5 w-5 bg-sanctuary-200 dark:bg-sanctuary-700 rounded"></div>
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-3/4"></div>
            <div className="h-4 bg-sanctuary-200 dark:bg-sanctuary-700 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (featureUnavailable) {
    return (
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3 mb-4">
          <Zap className="w-5 h-5 text-sanctuary-400" />
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Autopilot</h3>
        </div>
        <div className="p-4 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-sanctuary-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Feature not available</p>
              <p className="text-xs text-sanctuary-500 mt-1">
                Treasury Autopilot is not enabled on this server.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3 mb-4">
          <Zap className="w-5 h-5 text-primary-600 dark:text-primary-500" />
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Autopilot</h3>
          {success && (
            <span className="text-xs text-success-600 dark:text-success-400 ml-auto">Saved!</span>
          )}
        </div>

        {!notificationsAvailable ? (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Notifications required</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Configure Telegram or push notifications in Account Settings to use Autopilot.
                  Autopilot sends consolidation suggestions via notification channels.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg mb-4">
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              </div>
            )}

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable Autopilot</p>
                <p className="text-xs text-sanctuary-500">Monitor UTXOs and suggest consolidation when conditions are favorable</p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('enabled')}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.enabled
                    ? 'bg-success-500'
                    : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
                    settings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {settings.enabled && (
              <div className="mt-4 space-y-5">
                {/* Conditions group */}
                <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-4">
                  <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Conditions</p>

                  <NumberField
                    label="Max fee rate (sat/vB)"
                    helper="Only suggest when economy fee is below this"
                    value={settings.maxFeeRate}
                    onChange={(v) => handleNumberChange('maxFeeRate', v)}
                    onBlur={() => handleNumberBlur('maxFeeRate')}
                    disabled={saving}
                  />

                  <NumberField
                    label="Min UTXO count"
                    helper="Minimum consolidation candidates before notifying"
                    value={settings.minUtxoCount}
                    onChange={(v) => handleNumberChange('minUtxoCount', v)}
                    onBlur={() => handleNumberBlur('minUtxoCount')}
                    disabled={saving}
                  />

                  <NumberField
                    label="Dust threshold (sats)"
                    helper="UTXOs below this are considered dust"
                    value={settings.dustThreshold}
                    onChange={(v) => handleNumberChange('dustThreshold', v)}
                    onBlur={() => handleNumberBlur('dustThreshold')}
                    disabled={saving}
                  />
                </div>

                {/* Advanced filters (collapsed by default) */}
                <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1.5 text-xs font-medium text-sanctuary-500 uppercase tracking-wide hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
                    Advanced Filters
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 space-y-4">
                      <NumberField
                        label="Min dust UTXOs"
                        helper="Require at least this many dust UTXOs (0 = no requirement)"
                        value={settings.minDustCount}
                        onChange={(v) => handleNumberChange('minDustCount', v)}
                        onBlur={() => handleNumberBlur('minDustCount')}
                        disabled={saving}
                      />

                      <NumberField
                        label="Max UTXO size (sats)"
                        helper="Only count UTXOs below this size (0 = count all)"
                        value={settings.maxUtxoSize}
                        onChange={(v) => handleNumberChange('maxUtxoSize', v)}
                        onBlur={() => handleNumberBlur('maxUtxoSize')}
                        disabled={saving}
                      />

                      <NumberField
                        label="Cooldown (hours)"
                        helper="Hours between repeat notifications"
                        value={settings.cooldownHours}
                        onChange={(v) => handleNumberChange('cooldownHours', v)}
                        onBlur={() => handleNumberBlur('cooldownHours')}
                        disabled={saving}
                      />
                    </div>
                  )}
                </div>

                {/* Notification channels */}
                <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-3">
                  <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Notify via</p>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Telegram</span>
                    <input
                      type="checkbox"
                      checked={settings.notifyTelegram}
                      onChange={() => handleToggle('notifyTelegram')}
                      disabled={saving}
                      className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Push notifications</span>
                    <input
                      type="checkbox"
                      checked={settings.notifyPush}
                      onChange={() => handleToggle('notifyPush')}
                      disabled={saving}
                      className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* UTXO Health Status Card */}
      {notificationsAvailable && settings.enabled && status && (
        <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3 mb-4">
            <Activity className="w-5 h-5 text-primary-600 dark:text-primary-500" />
            <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">UTXO Health</h3>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Total UTXOs</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-medium">{status.utxoHealth.totalUtxos}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Candidates</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-medium">{status.utxoHealth.consolidationCandidates}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Dust UTXOs</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-medium">{status.utxoHealth.dustCount}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Dust value</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-mono text-xs">{formatSats(status.utxoHealth.dustValue)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Smallest</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-mono text-xs">{formatSats(status.utxoHealth.smallestUtxo)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
              <span className="text-sanctuary-500">Largest</span>
              <span className="text-sanctuary-900 dark:text-sanctuary-100 font-mono text-xs">{formatSats(status.utxoHealth.largestUtxo)}</span>
            </div>
            {status.feeSnapshot && (
              <div className="flex items-center justify-between py-1.5 col-span-2">
                <span className="text-sanctuary-500">Economy fee</span>
                <span className="text-sanctuary-900 dark:text-sanctuary-100 font-medium">{status.feeSnapshot.economy} sat/vB</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Reusable number input field */
function NumberField({
  label,
  helper,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  label: string;
  helper: string;
  value: number;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{label}</p>
        <p className="text-xs text-sanctuary-500">{helper}</p>
      </div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        className="w-24 px-3 py-2 text-sm border border-sanctuary-300 dark:border-sanctuary-600 rounded-lg bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
      />
    </div>
  );
}

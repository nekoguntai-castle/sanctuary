/**
 * Wallet Telegram Settings Component
 *
 * Per-wallet Telegram notification settings configuration.
 */

import React, { useEffect, useState } from 'react';
import { WalletTelegramSettings as WalletTelegramSettingsType } from '../../types';
import * as walletsApi from '../../src/api/wallets';
import { ApiError } from '../../src/api/client';
import { useUser } from '../../contexts/UserContext';
import { createLogger } from '../../utils/logger';
import { Send, AlertCircle } from 'lucide-react';
import { Toggle } from '../ui/Toggle';

const log = createLogger('WalletTelegramSettings');

interface Props {
  walletId: string;
}

export const WalletTelegramSettings: React.FC<Props> = ({ walletId }) => {
  const { user } = useUser();
  const [settings, setSettings] = useState<WalletTelegramSettingsType>({
    enabled: false,
    notifyReceived: true,
    notifySent: true,
    notifyConsolidation: true,
    notifyDraft: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Check if user has Telegram configured
  const telegramConfigured = Boolean(
    user?.preferences?.telegram?.botToken && user?.preferences?.telegram?.chatId
  );
  const telegramEnabled = user?.preferences?.telegram?.enabled;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await walletsApi.getWalletTelegramSettings(walletId);
        setSettings(data);
      } catch (err) {
        log.debug('Using default telegram settings', { error: err });
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [walletId]);

  const handleToggle = async (field: keyof WalletTelegramSettingsType) => {
    const newSettings = { ...settings, [field]: !settings[field] };
    setSettings(newSettings);
    setSaving(true);
    setError(null);

    try {
      await walletsApi.updateWalletTelegramSettings(walletId, newSettings);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      // Revert on error
      setSettings(settings);
      const message = err instanceof ApiError ? err.message : 'Failed to update settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="surface-elevated rounded-2xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
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

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Send className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Telegram Notifications</h3>
          {success && (
            <span className="text-xs text-success-600 dark:text-success-400 ml-auto">Saved!</span>
          )}
        </div>
      </div>

      <div className="p-6">
      {!telegramConfigured ? (
        <div className="p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-xl">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-warning-600 dark:text-warning-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-warning-700 dark:text-warning-300">Telegram not configured</p>
              <p className="text-xs text-warning-600 dark:text-warning-400 mt-1">
                Configure your Telegram bot in Account Settings to receive notifications.
              </p>
            </div>
          </div>
        </div>
      ) : !telegramEnabled ? (
        <div className="p-4 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-sanctuary-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Telegram notifications disabled</p>
              <p className="text-xs text-sanctuary-500 mt-1">
                Enable Telegram notifications globally in Account Settings first.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>
            </div>
          )}

          {/* Enable for this wallet */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable for this wallet</p>
              <p className="text-xs text-sanctuary-500">Receive notifications for this wallet's transactions</p>
            </div>
            <Toggle
              checked={settings.enabled}
              onChange={() => handleToggle('enabled')}
              disabled={saving}
              color="success"
            />
          </div>

          {settings.enabled && (
            <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-3">
              <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Notify me when:</p>

              {/* Received */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Bitcoin received</span>
                <input
                  type="checkbox"
                  checked={settings.notifyReceived}
                  onChange={() => handleToggle('notifyReceived')}
                  disabled={saving}
                  className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
              </label>

              {/* Sent */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Bitcoin sent</span>
                <input
                  type="checkbox"
                  checked={settings.notifySent}
                  onChange={() => handleToggle('notifySent')}
                  disabled={saving}
                  className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
              </label>

              {/* Consolidation */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Consolidation transactions</span>
                <input
                  type="checkbox"
                  checked={settings.notifyConsolidation}
                  onChange={() => handleToggle('notifyConsolidation')}
                  disabled={saving}
                  className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
              </label>

              {/* Draft transactions */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">Draft transactions (awaiting signature)</span>
                <input
                  type="checkbox"
                  checked={settings.notifyDraft}
                  onChange={() => handleToggle('notifyDraft')}
                  disabled={saving}
                  className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
              </label>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
};

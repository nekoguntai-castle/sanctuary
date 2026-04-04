import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Shield } from 'lucide-react';
import * as intelligenceApi from '../../../src/api/intelligence';
import type { WalletIntelligenceSettings } from '../../../src/api/intelligence';
import { createLogger } from '../../../utils/logger';

const log = createLogger('IntelligenceSettings');

interface SettingsTabProps {
  walletId: string;
}

const SEVERITY_OPTIONS: { value: WalletIntelligenceSettings['severityFilter']; label: string }[] = [
  { value: 'info', label: 'All (Info and above)' },
  { value: 'warning', label: 'Warning and above' },
  { value: 'critical', label: 'Critical only' },
];

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'utxo_health', label: 'UTXO Health' },
  { value: 'fee_timing', label: 'Fee Timing' },
  { value: 'anomaly', label: 'Anomaly Detection' },
  { value: 'tax', label: 'Tax Implications' },
  { value: 'consolidation', label: 'Consolidation' },
];

export const SettingsTab: React.FC<SettingsTabProps> = ({ walletId }) => {
  const [settings, setSettings] = useState<WalletIntelligenceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const result = await intelligenceApi.getIntelligenceSettings(walletId);
      setSettings(result.settings);
    } catch (error) {
      log.error('Failed to load intelligence settings', { error });
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = useCallback(
    async (update: Partial<WalletIntelligenceSettings>) => {
      if (!settings) return;

      const newSettings = { ...settings, ...update };
      setSettings(newSettings);
      setSaving(true);

      try {
        const result = await intelligenceApi.updateIntelligenceSettings(walletId, update);
        setSettings(result.settings);
      } catch (error) {
        log.error('Failed to update settings', { error });
        // Revert on failure
        setSettings(settings);
      } finally {
        setSaving(false);
      }
    },
    [settings, walletId]
  );

  const handleTypeFilterToggle = useCallback(
    (type: string) => {
      if (!settings) return;
      const current = settings.typeFilter;
      const updated = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      updateSetting({ typeFilter: updated });
    },
    [settings, updateSetting]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sanctuary-500 dark:text-sanctuary-400">
        <Settings className="h-8 w-8" />
        <p className="text-sm">Failed to load intelligence settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary-600 dark:text-primary-300" />
        <h2 className="text-[11px] font-semibold text-sanctuary-800 dark:text-sanctuary-200">
          Intelligence Settings
        </h2>
        {saving && (
          <span className="text-[9px] text-sanctuary-400 dark:text-sanctuary-500">Saving...</span>
        )}
      </div>

      {/* Enable intelligence */}
      <ToggleRow
        label="Enable intelligence"
        description="Allow AI to analyze this wallet and generate insights"
        checked={settings.enabled}
        onChange={(checked) => updateSetting({ enabled: checked })}
      />

      {/* Notifications section */}
      <div className="rounded-xl border border-sanctuary-200 bg-white p-3 dark:border-sanctuary-800 dark:bg-sanctuary-900">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-sanctuary-500 dark:text-sanctuary-400">
          Notifications
        </p>
        <div className="space-y-3">
          <ToggleRow
            label="Telegram notifications"
            description="Receive insight alerts via Telegram"
            checked={settings.notifyTelegram}
            onChange={(checked) => updateSetting({ notifyTelegram: checked })}
            disabled={!settings.enabled}
          />
          <ToggleRow
            label="Push notifications"
            description="Receive insight alerts via push notifications"
            checked={settings.notifyPush}
            onChange={(checked) => updateSetting({ notifyPush: checked })}
            disabled={!settings.enabled}
          />
        </div>
      </div>

      {/* Severity filter */}
      <div className="rounded-xl border border-sanctuary-200 bg-white p-3 dark:border-sanctuary-800 dark:bg-sanctuary-900">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sanctuary-500 dark:text-sanctuary-400">
          Minimum Severity
        </p>
        <p className="mb-2 text-[10px] text-sanctuary-500 dark:text-sanctuary-400">
          Only show insights at or above this severity level
        </p>
        <select
          value={settings.severityFilter}
          onChange={(e) =>
            updateSetting({
              severityFilter: e.target.value as WalletIntelligenceSettings['severityFilter'],
            })
          }
          disabled={!settings.enabled}
          className="w-full rounded-md border border-sanctuary-200 bg-sanctuary-50 px-2.5 py-1.5 text-[11px] text-sanctuary-700 transition-colors focus:border-primary-500 focus:outline-none disabled:opacity-50 dark:border-sanctuary-700 dark:bg-sanctuary-950 dark:text-sanctuary-300"
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Type filter */}
      <div className="rounded-xl border border-sanctuary-200 bg-white p-3 dark:border-sanctuary-800 dark:bg-sanctuary-900">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sanctuary-500 dark:text-sanctuary-400">
          Insight Types
        </p>
        <p className="mb-2 text-[10px] text-sanctuary-500 dark:text-sanctuary-400">
          Select which types of insights to generate
        </p>
        <div className="space-y-2">
          {TYPE_FILTER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 ${
                !settings.enabled ? 'opacity-50' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={settings.typeFilter.includes(opt.value)}
                onChange={() => handleTypeFilterToggle(opt.value)}
                disabled={!settings.enabled}
                className="h-3.5 w-3.5 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500 dark:border-sanctuary-600 dark:bg-sanctuary-800"
              />
              <span className="text-[11px] text-sanctuary-700 dark:text-sanctuary-300">
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

/** Reusable toggle row */
const ToggleRow: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ label, description, checked, onChange, disabled }) => (
  <div
    className={`flex items-center justify-between rounded-xl border border-sanctuary-200 bg-white px-3 py-2.5 dark:border-sanctuary-800 dark:bg-sanctuary-900 ${
      disabled ? 'opacity-50' : ''
    }`}
  >
    <div>
      <p className="text-[11px] font-medium text-sanctuary-800 dark:text-sanctuary-200">{label}</p>
      <p className="text-[10px] text-sanctuary-500 dark:text-sanctuary-400">{description}</p>
    </div>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked
          ? 'bg-primary-600 dark:bg-primary-200'
          : 'bg-sanctuary-200 dark:bg-sanctuary-700'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform dark:bg-sanctuary-900 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);

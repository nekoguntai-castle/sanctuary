import { AlertCircle, ChevronDown, Zap } from 'lucide-react';
import type { WalletAutopilotSettings as AutopilotSettingsType } from '../../../types';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { Toggle } from '../../ui/Toggle';

type ToggleField = 'enabled' | 'notifyTelegram' | 'notifyPush';
type NumberFieldName = keyof AutopilotSettingsType;

interface NumberFieldProps {
  label: string;
  helper: string;
  value: number;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
}

interface SettingsControlsProps {
  settings: AutopilotSettingsType;
  saving: boolean;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onToggle: (field: ToggleField) => void;
  onNumberChange: (field: NumberFieldName, value: string) => void;
  onNumberBlur: (field: NumberFieldName) => void;
}

interface AutopilotSettingsCardProps extends SettingsControlsProps {
  success: boolean;
  error: string | null;
  notificationsAvailable: boolean;
}

function AutopilotHeader({ success }: { success: boolean }) {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Zap className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Autopilot</h3>
        {success && (
          <span className="text-xs text-success-600 dark:text-success-400 ml-auto">Saved!</span>
        )}
      </div>
    </div>
  );
}

function NotificationsRequiredNotice() {
  return (
    <div className="p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg">
      <div className="flex items-start space-x-3">
        <AlertCircle className="w-5 h-5 text-warning-600 dark:text-warning-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-warning-700 dark:text-warning-300">Notifications required</p>
          <p className="text-xs text-warning-600 dark:text-warning-400 mt-1">
            Configure Telegram or push notifications in Account Settings to use Autopilot.
            Autopilot sends consolidation suggestions via notification channels.
          </p>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  helper,
  value,
  onChange,
  onBlur,
  disabled,
}: NumberFieldProps) {
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
        className="w-24 px-3 py-2 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
      />
    </div>
  );
}

function EnabledToggle({
  enabled,
  saving,
  onToggle,
}: {
  enabled: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable Autopilot</p>
        <p className="text-xs text-sanctuary-500">Monitor UTXOs and suggest consolidation when conditions are favorable</p>
      </div>
      <Toggle
        checked={enabled}
        onChange={onToggle}
        disabled={saving}
        color="success"
      />
    </div>
  );
}

function ConditionsSection({
  settings,
  saving,
  onNumberChange,
  onNumberBlur,
}: Pick<SettingsControlsProps, 'settings' | 'saving' | 'onNumberChange' | 'onNumberBlur'>) {
  return (
    <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-4">
      <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Conditions</p>
      <NumberField
        label="Max fee rate (sat/vB)"
        helper="Only suggest when economy fee is below this"
        value={settings.maxFeeRate}
        onChange={(value) => onNumberChange('maxFeeRate', value)}
        onBlur={() => onNumberBlur('maxFeeRate')}
        disabled={saving}
      />
      <NumberField
        label="Min UTXO count"
        helper="Minimum consolidation candidates before notifying"
        value={settings.minUtxoCount}
        onChange={(value) => onNumberChange('minUtxoCount', value)}
        onBlur={() => onNumberBlur('minUtxoCount')}
        disabled={saving}
      />
      <NumberField
        label="Dust threshold (sats)"
        helper="UTXOs below this are considered dust"
        value={settings.dustThreshold}
        onChange={(value) => onNumberChange('dustThreshold', value)}
        onBlur={() => onNumberBlur('dustThreshold')}
        disabled={saving}
      />
    </div>
  );
}

function AdvancedFiltersSection({
  settings,
  saving,
  showAdvanced,
  onToggleAdvanced,
  onNumberChange,
  onNumberBlur,
}: Pick<
  SettingsControlsProps,
  'settings' | 'saving' | 'showAdvanced' | 'onToggleAdvanced' | 'onNumberChange' | 'onNumberBlur'
>) {
  return (
    <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700">
      <button
        type="button"
        onClick={onToggleAdvanced}
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
            onChange={(value) => onNumberChange('minDustCount', value)}
            onBlur={() => onNumberBlur('minDustCount')}
            disabled={saving}
          />
          <NumberField
            label="Max UTXO size (sats)"
            helper="Only count UTXOs below this size (0 = count all)"
            value={settings.maxUtxoSize}
            onChange={(value) => onNumberChange('maxUtxoSize', value)}
            onBlur={() => onNumberBlur('maxUtxoSize')}
            disabled={saving}
          />
          <NumberField
            label="Cooldown (hours)"
            helper="Hours between repeat notifications"
            value={settings.cooldownHours}
            onChange={(value) => onNumberChange('cooldownHours', value)}
            onBlur={() => onNumberBlur('cooldownHours')}
            disabled={saving}
          />
        </div>
      )}
    </div>
  );
}

function NotificationChannelToggle({
  label,
  checked,
  saving,
  onToggle,
}: {
  label: string;
  checked: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={saving}
        className="h-4 w-4 rounded border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-primary-600 focus:ring-primary-500 dark:focus:ring-primary-400"
      />
    </label>
  );
}

function NotificationChannelsSection({
  settings,
  saving,
  onToggle,
}: Pick<SettingsControlsProps, 'settings' | 'saving' | 'onToggle'>) {
  return (
    <div className="pl-4 border-l-2 border-sanctuary-200 dark:border-sanctuary-700 space-y-3">
      <p className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide">Notify via</p>
      <NotificationChannelToggle
        label="Telegram"
        checked={settings.notifyTelegram}
        saving={saving}
        onToggle={() => onToggle('notifyTelegram')}
      />
      <NotificationChannelToggle
        label="Push notifications"
        checked={settings.notifyPush}
        saving={saving}
        onToggle={() => onToggle('notifyPush')}
      />
    </div>
  );
}

function EnabledSettingsSections(props: SettingsControlsProps) {
  if (!props.settings.enabled) return null;

  return (
    <div className="mt-4 space-y-5">
      <ConditionsSection {...props} />
      <AdvancedFiltersSection {...props} />
      <NotificationChannelsSection {...props} />
    </div>
  );
}

function AutopilotSettingsControls(props: SettingsControlsProps & { error: string | null }) {
  return (
    <div>
      <ErrorAlert message={props.error} />
      <EnabledToggle
        enabled={props.settings.enabled}
        saving={props.saving}
        onToggle={() => props.onToggle('enabled')}
      />
      <EnabledSettingsSections {...props} />
    </div>
  );
}

export function AutopilotSettingsCard({
  settings,
  saving,
  success,
  error,
  notificationsAvailable,
  showAdvanced,
  onToggleAdvanced,
  onToggle,
  onNumberChange,
  onNumberBlur,
}: AutopilotSettingsCardProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <AutopilotHeader success={success} />
      <div className="p-6">
        {!notificationsAvailable ? (
          <NotificationsRequiredNotice />
        ) : (
          <AutopilotSettingsControls
            settings={settings}
            saving={saving}
            error={error}
            showAdvanced={showAdvanced}
            onToggleAdvanced={onToggleAdvanced}
            onToggle={onToggle}
            onNumberChange={onNumberChange}
            onNumberBlur={onNumberBlur}
          />
        )}
      </div>
    </div>
  );
}

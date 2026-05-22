import { Send } from 'lucide-react';
import {
  clampNumber,
  DEFAULT_HMAC_CONFIG,
  inputClassName,
  labelClassName,
  type AuthType,
  type PayloadProfile,
  type ValuationMode,
  type WebhookFormState,
} from './model';

export function WalletWebhookForm({
  form,
  saving,
  canSave,
  onFormChange,
  onCreate,
}: {
  form: WebhookFormState;
  saving: boolean;
  canSave: boolean;
  onFormChange: (next: WebhookFormState) => void;
  onCreate: () => void;
}) {
  const update = <K extends keyof WebhookFormState>(key: K, value: WebhookFormState[K]) => {
    onFormChange({ ...form, [key]: value });
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          placeholder="Endpoint name"
          className={inputClassName}
        />
        <input
          value={form.url}
          onChange={(event) => update('url', event.target.value)}
          placeholder="https://example.com/webhook"
          className={inputClassName}
        />
      </div>
      <input
        value={form.eventTypes}
        onChange={(event) => update('eventTypes', event.target.value)}
        placeholder="Event types"
        className={inputClassName}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField
          label="Payload"
          value={form.payloadProfile}
          onChange={(value) => update('payloadProfile', value as PayloadProfile)}
          options={[
            ['sanctuary_wallet_event_v1', 'Sanctuary event'],
            ['mapped_json_v1', 'Mapped JSON'],
          ]}
        />
        <SelectField
          label="Auth"
          value={form.authType}
          onChange={(value) => {
            const authType = value as AuthType;
            onFormChange({
              ...form,
              authType,
              headerConfigJson: authType === 'configured_hmac_sha256' && !form.headerConfigJson.trim()
                ? DEFAULT_HMAC_CONFIG
                : form.headerConfigJson,
            });
          }}
          options={[
            ['none', 'None'],
            ['bearer', 'Bearer'],
            ['hmac_sha256', 'Sanctuary HMAC'],
            ['configured_hmac_sha256', 'Configured HMAC'],
          ]}
        />
        <label className={labelClassName}>
          Secret
          <input
            value={form.secret}
            onChange={(event) => update('secret', event.target.value)}
            placeholder={form.authType === 'none' ? 'No secret required' : 'Signing secret'}
            type="password"
            className={inputClassName}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
          <input
            type="checkbox"
            checked={form.failureNotificationEnabled}
            onChange={(event) => update('failureNotificationEnabled', event.target.checked)}
          />
          Alert on max retries
        </label>
        <label className="flex items-center gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
          Max retries
          <input
            type="number"
            min={1}
            max={25}
            value={form.maxAttempts}
            onChange={(event) => update('maxAttempts', clampNumber(event.target.value, 1, 25))}
            className={`${inputClassName} w-20`}
          />
        </label>
        <button
          type="button"
          onClick={() => update('advancedOpen', !form.advancedOpen)}
          className="px-3 py-2 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 text-sm text-sanctuary-700 dark:text-sanctuary-300"
        >
          Advanced
        </button>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {saving ? 'Saving...' : 'Add webhook'}
        </button>
      </div>

      {form.advancedOpen && (
        <AdvancedWebhookFields form={form} update={update} />
      )}
    </div>
  );
}

function AdvancedWebhookFields({
  form,
  update,
}: {
  form: WebhookFormState;
  update: <K extends keyof WebhookFormState>(key: K, value: WebhookFormState[K]) => void;
}) {
  return (
    <div className="grid gap-3 border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField
          label="Valuation"
          value={form.valuationMode}
          onChange={(value) => update('valuationMode', value as ValuationMode)}
          options={[
            ['disabled', 'Disabled'],
            ['optional', 'Optional'],
            ['required', 'Required'],
          ]}
        />
        <label className={labelClassName}>
          Currency
          <input
            value={form.valuationCurrency}
            onChange={(event) => update('valuationCurrency', event.target.value.toUpperCase())}
            maxLength={8}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Backoff
          <input
            type="number"
            min={1}
            step={0.1}
            value={form.retryBackoffMultiplier}
            onChange={(event) => update('retryBackoffMultiplier', Number(event.target.value))}
            className={inputClassName}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DelayField label="Initial retry delay ms" value={form.retryInitialDelayMs} onChange={(value) => update('retryInitialDelayMs', value)} />
        <DelayField label="Max retry delay ms" value={form.retryMaxDelayMs} onChange={(value) => update('retryMaxDelayMs', value)} />
      </div>
      <JsonTextarea label="Filters JSON" value={form.filtersJson} onChange={(value) => update('filtersJson', value)} />
      {form.payloadProfile === 'mapped_json_v1' && (
        <JsonTextarea label="Body mapping JSON" value={form.bodyMappingJson} onChange={(value) => update('bodyMappingJson', value)} />
      )}
      <JsonTextarea label="Headers and HMAC JSON" value={form.headerConfigJson} onChange={(value) => update('headerConfigJson', value)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={labelClassName}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClassName}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>{text}</option>
        ))}
      </select>
    </label>
  );
}

function DelayField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={labelClassName}>
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(clampNumber(event.target.value, 1))}
        className={inputClassName}
      />
    </label>
  );
}

function JsonTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={labelClassName}>
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        spellCheck={false}
        className={`${inputClassName} font-mono`}
      />
    </label>
  );
}

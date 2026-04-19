import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AgentManagementOptions, WalletAgentMetadata, WalletAgentStatus } from '../../../src/api/admin';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { ModalWrapper } from '../../ui/ModalWrapper';
import { Toggle } from '../../ui/Toggle';
import {
  createInitialAgentForm,
  MONITORING_NUMBER_FIELDS,
  MONITORING_SATS_FIELDS,
  POLICY_FIELDS,
  type AgentFormState,
  type SetAgentFormField,
} from './formState';
import {
  canSubmitAgentForm,
  getFundingWallets,
  getOperationalWallets,
  getSelectedFundingWallet,
  getSignerDevices,
  reconcileAgentFormSelections,
  setAgentFormFundingWallet,
  setAgentFormUser,
  toDeviceOptions,
  toUserOptions,
  toWalletOptions,
  type SelectOption,
} from './formOptions';

type AgentFormModalProps = {
  title: string;
  agent?: WalletAgentMetadata;
  options: AgentManagementOptions;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (form: AgentFormState) => Promise<void>;
};

export function AgentFormModal({
  title,
  agent,
  options,
  isSaving,
  onClose,
  onSubmit,
}: AgentFormModalProps) {
  const [form, setForm] = useState<AgentFormState>(() => createInitialAgentForm(agent));
  const selectedFundingWallet = useMemo(
    () => getSelectedFundingWallet(options.wallets, form.fundingWalletId),
    [form.fundingWalletId, options.wallets]
  );
  const fundingWallets = useMemo(
    () => getFundingWallets(options.wallets, form.userId),
    [form.userId, options.wallets]
  );
  const operationalWallets = useMemo(
    () => getOperationalWallets(options.wallets, form, selectedFundingWallet),
    [form, options.wallets, selectedFundingWallet]
  );
  const signerDevices = useMemo(
    () => getSignerDevices(options.devices, form.fundingWalletId),
    [form.fundingWalletId, options.devices]
  );
  const userOptions = useMemo(() => toUserOptions(options.users), [options.users]);
  const fundingOptions = useMemo(() => toWalletOptions(fundingWallets), [fundingWallets]);
  const operationalOptions = useMemo(() => toWalletOptions(operationalWallets), [operationalWallets]);
  const signerOptions = useMemo(() => toDeviceOptions(signerDevices), [signerDevices]);
  const isEditing = Boolean(agent);
  const canSubmit = canSubmitAgentForm(form);

  useEffect(() => {
    setForm(current => reconcileAgentFormSelections(current, fundingWallets, operationalWallets, signerDevices));
  }, [form.userId, form.fundingWalletId, form.operationalWalletId, form.signerDeviceId, fundingWallets, operationalWallets, signerDevices]);

  const setField: SetAgentFormField = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const setUser = (userId: string) => {
    setForm(current => setAgentFormUser(current, userId));
  };
  const setFundingWallet = (fundingWalletId: string) => {
    setForm(current => setAgentFormFundingWallet(current, fundingWalletId));
  };

  return (
    <ModalWrapper title={title} onClose={onClose} maxWidth="2xl" headerBorder>
      <div className="space-y-4">
        <AgentNameField value={form.name} onChange={(value) => setField('name', value)} />
        <AgentIdentityFields
          form={form}
          isEditing={isEditing}
          userOptions={userOptions}
          fundingOptions={fundingOptions}
          operationalOptions={operationalOptions}
          signerOptions={signerOptions}
          onFieldChange={setField}
          onUserChange={setUser}
          onFundingWalletChange={setFundingWallet}
        />
        <PolicyFields form={form} onFieldChange={setField} />
        <OperationalAlertFields form={form} onFieldChange={setField} />
        <AgentToggleFields form={form} onFieldChange={setField} />
        <AgentFormWarning />
      </div>

      <AgentFormActions
        isSaving={isSaving}
        canSubmit={canSubmit}
        submitLabel={isEditing ? 'Save Agent' : 'Create Agent'}
        onClose={onClose}
        onSubmit={() => onSubmit(form)}
      />
    </ModalWrapper>
  );
}

function AgentNameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Agent name *</label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Treasury funding agent" autoFocus />
    </div>
  );
}

function AgentIdentityFields({
  form,
  isEditing,
  userOptions,
  fundingOptions,
  operationalOptions,
  signerOptions,
  onFieldChange,
  onUserChange,
  onFundingWalletChange,
}: {
  form: AgentFormState;
  isEditing: boolean;
  userOptions: SelectOption[];
  fundingOptions: SelectOption[];
  operationalOptions: SelectOption[];
  signerOptions: SelectOption[];
  onFieldChange: SetAgentFormField;
  onUserChange: (userId: string) => void;
  onFundingWalletChange: (fundingWalletId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SelectField
        label="Target user *"
        value={form.userId}
        disabled={isEditing}
        onChange={onUserChange}
        options={userOptions}
      />
      <SelectField
        label="Status"
        value={form.status}
        onChange={(value) => onFieldChange('status', value as WalletAgentStatus)}
        options={getStatusOptions()}
      />
      <SelectField
        label="Funding wallet *"
        value={form.fundingWalletId}
        disabled={isEditing || !form.userId}
        onChange={onFundingWalletChange}
        options={fundingOptions}
      />
      <SelectField
        label="Operational wallet *"
        value={form.operationalWalletId}
        disabled={isEditing || !form.fundingWalletId}
        onChange={(value) => onFieldChange('operationalWalletId', value)}
        options={operationalOptions}
      />
      <SelectField
        label="Agent signer device *"
        value={form.signerDeviceId}
        disabled={isEditing || !form.fundingWalletId}
        onChange={(value) => onFieldChange('signerDeviceId', value)}
        options={signerOptions}
      />
      <NumberField
        label="Cooldown minutes"
        ariaLabel="Cooldown minutes"
        value={form.cooldownMinutes}
        onChange={(value) => onFieldChange('cooldownMinutes', value)}
        placeholder="0"
      />
    </div>
  );
}

function PolicyFields({ form, onFieldChange }: { form: AgentFormState; onFieldChange: SetAgentFormField }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {POLICY_FIELDS.map(field => (
        <NumberField
          key={field.key}
          label={field.label}
          value={form[field.key]}
          onChange={(value) => onFieldChange(field.key, value)}
          placeholder="No cap"
          helper={field.helper}
        />
      ))}
    </div>
  );
}

function OperationalAlertFields({ form, onFieldChange }: { form: AgentFormState; onFieldChange: SetAgentFormField }) {
  return (
    <div className="space-y-3 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
      <div>
        <h3 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">Operational alerts</h3>
        <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">
          Persist alert history for balance drift, large operational transactions, and repeated rejected funding attempts.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MONITORING_SATS_FIELDS.map(field => (
          <NumberField
            key={field.key}
            label={field.label}
            value={form[field.key]}
            onChange={(value) => onFieldChange(field.key, value)}
            placeholder="Off"
            helper={field.helper}
          />
        ))}
        {MONITORING_NUMBER_FIELDS.map(field => (
          <NumberField
            key={field.key}
            label={field.label}
            min={1}
            value={form[field.key]}
            onChange={(value) => onFieldChange(field.key, value)}
            placeholder={field.placeholder}
            helper={field.helper}
          />
        ))}
      </div>
    </div>
  );
}

function AgentToggleFields({ form, onFieldChange }: { form: AgentFormState; onFieldChange: SetAgentFormField }) {
  return (
    <div className="space-y-3 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
      <ToggleRow label="Human multisig approval required" checked={form.requireHumanApproval} onChange={onFieldChange.bind(null, 'requireHumanApproval')} disabled />
      <ToggleRow label="Notify on operational spend" checked={form.notifyOnOperationalSpend} onChange={onFieldChange.bind(null, 'notifyOnOperationalSpend')} />
      <ToggleRow label="Pause future funding after operational spend" checked={form.pauseOnUnexpectedSpend} onChange={onFieldChange.bind(null, 'pauseOnUnexpectedSpend')} color="warning" />
    </div>
  );
}

function AgentFormWarning() {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>Once funded, the operational wallet can spend without multisig approval. These settings only gate future funding and notifications.</span>
    </div>
  );
}

function AgentFormActions({
  isSaving,
  canSubmit,
  submitLabel,
  onClose,
  onSubmit,
}: {
  isSaving: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button onClick={onSubmit} isLoading={isSaving} disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}

function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  placeholder,
  helper,
  min = 0,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helper?: string;
  min?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <Input
        type="number"
        min={min}
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {helper && <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
      >
        <option value="">Select...</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: 'primary' | 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} color={color} />
    </div>
  );
}

function getStatusOptions(): SelectOption[] {
  return [
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'revoked', label: 'Revoked' },
  ];
}

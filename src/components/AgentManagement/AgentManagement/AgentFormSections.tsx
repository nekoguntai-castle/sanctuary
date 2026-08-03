import { AlertTriangle } from 'lucide-react';
import type { AgentOptionWallet, WalletAgentStatus } from '../../../api/admin';
import {
  MONITORING_NUMBER_FIELDS,
  MONITORING_SATS_FIELDS,
  POLICY_FIELDS,
  type AgentFormState,
  type SetAgentFormField,
} from './formState';
import { canSubmitAgentForm, type SelectOption } from './formOptions';
import { InlineOperationalWalletImport } from './InlineOperationalWalletImport';
import {
  AgentFormActions,
  AgentNameField,
  FullImportPageLink,
  NumberField,
  SelectField,
  ToggleRow,
} from './AgentFormControls';

export { AgentFormActions };

export const CREATE_STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'policies', label: 'Policies' },
  { id: 'monitoring', label: 'Monitoring' },
] as const;
export const FINAL_CREATE_STEP_INDEX = CREATE_STEPS.length - 1;

type AgentFormFieldsProps = {
  form: AgentFormState;
  userOptions: SelectOption[];
  fundingOptions: SelectOption[];
  operationalOptions: SelectOption[];
  signerOptions: SelectOption[];
  onFieldChange: SetAgentFormField;
  onUserChange: (userId: string) => void;
  onFundingWalletChange: (fundingWalletId: string) => void;
};

export function canAdvanceCreateStep(form: AgentFormState, stepIndex: number): boolean {
  const stepId = CREATE_STEPS[stepIndex]?.id;
  switch (stepId) {
    case 'basics':
      return Boolean(form.name.trim() && form.userId);
    case 'wallets':
      return Boolean(form.fundingWalletId && form.operationalWalletId);
    case 'policies':
      return true;
    case 'monitoring':
      return canSubmitAgentForm(form);
    default:
      return false;
  }
}

export function EditAgentFormFields(props: AgentFormFieldsProps) {
  const {
    form,
    userOptions,
    fundingOptions,
    operationalOptions,
    signerOptions,
    onFieldChange,
    onUserChange,
    onFundingWalletChange,
  } = props;

  return (
    <>
      <AgentNameField value={form.name} onChange={value => onFieldChange('name', value)} />
      <AgentIdentityFields
        form={form}
        userOptions={userOptions}
        fundingOptions={fundingOptions}
        operationalOptions={operationalOptions}
        signerOptions={signerOptions}
        onFieldChange={onFieldChange}
        onUserChange={onUserChange}
        onFundingWalletChange={onFundingWalletChange}
      />
      <PolicyFields form={form} onFieldChange={onFieldChange} />
      <OperationalAlertFields form={form} onFieldChange={onFieldChange} />
      <AgentToggleFields form={form} onFieldChange={onFieldChange} />
      <AgentFormWarning />
    </>
  );
}

export function CreateAgentWizardFields({
  stepIndex,
  selectedFundingWallet,
  onOperationalWalletImported,
  ...props
}: AgentFormFieldsProps & {
  stepIndex: number;
  selectedFundingWallet?: AgentOptionWallet;
  onOperationalWalletImported: (walletId: string) => Promise<void>;
}) {
  return (
    <>
      <AgentSetupProgress stepIndex={stepIndex} />
      {stepIndex === 0 && (
        <AgentBasicsStep
          form={props.form}
          userOptions={props.userOptions}
          onFieldChange={props.onFieldChange}
          onUserChange={props.onUserChange}
        />
      )}
      {stepIndex === 1 && (
        <AgentWalletStep
          form={props.form}
          fundingOptions={props.fundingOptions}
          operationalOptions={props.operationalOptions}
          signerOptions={props.signerOptions}
          selectedFundingWallet={selectedFundingWallet}
          onFieldChange={props.onFieldChange}
          onFundingWalletChange={props.onFundingWalletChange}
          onOperationalWalletImported={onOperationalWalletImported}
        />
      )}
      {stepIndex === 2 && <AgentPolicyStep form={props.form} onFieldChange={props.onFieldChange} />}
      {stepIndex === 3 && (
        <>
          <OperationalAlertFields form={props.form} onFieldChange={props.onFieldChange} />
          <AgentToggleFields form={props.form} onFieldChange={props.onFieldChange} />
          <AgentFormWarning />
        </>
      )}
    </>
  );
}

function AgentSetupProgress({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="grid grid-cols-4 gap-2" aria-label="Agent wallet setup progress">
      {CREATE_STEPS.map((step, index) => (
        <div
          key={step.id}
          aria-current={index === stepIndex ? 'step' : undefined}
          className={`h-9 rounded-md border px-2 text-xs font-medium flex items-center justify-center ${
            index === stepIndex
              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-200'
              : index < stepIndex
                ? 'border-success-300 bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300'
                : 'border-sanctuary-200 text-sanctuary-500 dark:border-sanctuary-800 dark:text-sanctuary-400'
          }`}
        >
          {step.label}
        </div>
      ))}
    </div>
  );
}

function AgentBasicsStep({
  form,
  userOptions,
  onFieldChange,
  onUserChange,
}: {
  form: AgentFormState;
  userOptions: SelectOption[];
  onFieldChange: SetAgentFormField;
  onUserChange: (userId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <AgentNameField value={form.name} onChange={value => onFieldChange('name', value)} />
      <SelectField label="Target user *" value={form.userId} onChange={onUserChange} options={userOptions} />
      <SelectField
        label="Status"
        value={form.status}
        onChange={value => onFieldChange('status', value as WalletAgentStatus)}
        options={getStatusOptions()}
      />
    </div>
  );
}

function AgentWalletStep({
  form,
  fundingOptions,
  operationalOptions,
  signerOptions,
  selectedFundingWallet,
  onFieldChange,
  onFundingWalletChange,
  onOperationalWalletImported,
}: {
  form: AgentFormState;
  fundingOptions: SelectOption[];
  operationalOptions: SelectOption[];
  signerOptions: SelectOption[];
  selectedFundingWallet?: AgentOptionWallet;
  onFieldChange: SetAgentFormField;
  onFundingWalletChange: (fundingWalletId: string) => void;
  onOperationalWalletImported: (walletId: string) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SelectField
        label="Funding wallet *"
        value={form.fundingWalletId}
        disabled={!form.userId}
        onChange={onFundingWalletChange}
        options={fundingOptions}
      />
      <SelectField
        label="Operational wallet *"
        value={form.operationalWalletId}
        disabled={!form.fundingWalletId}
        onChange={value => onFieldChange('operationalWalletId', value)}
        options={operationalOptions}
      />
      <div className="md:col-span-2">
        <InlineOperationalWalletImport
          selectedFundingWallet={selectedFundingWallet}
          disabled={!form.fundingWalletId}
          onImported={onOperationalWalletImported}
        />
      </div>
      <SelectField
        label="Funding signer device (optional)"
        value={form.signerDeviceId}
        disabled={!form.fundingWalletId}
        onChange={value => onFieldChange('signerDeviceId', value)}
        placeholder="Human wallet signers"
        options={signerOptions}
      />
      <FullImportPageLink />
    </div>
  );
}

function AgentPolicyStep({ form, onFieldChange }: { form: AgentFormState; onFieldChange: SetAgentFormField }) {
  return (
    <div className="space-y-4">
      <PolicyFields form={form} onFieldChange={onFieldChange} />
      <NumberField
        label="Cooldown minutes"
        ariaLabel="Cooldown minutes"
        value={form.cooldownMinutes}
        onChange={value => onFieldChange('cooldownMinutes', value)}
        placeholder="0"
      />
    </div>
  );
}

function AgentIdentityFields({
  form,
  userOptions,
  fundingOptions,
  operationalOptions,
  signerOptions,
  onFieldChange,
  onUserChange,
  onFundingWalletChange,
}: AgentFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SelectField
        label="Target user *"
        value={form.userId}
        disabled
        onChange={onUserChange}
        options={userOptions}
      />
      <SelectField
        label="Status"
        value={form.status}
        onChange={value => onFieldChange('status', value as WalletAgentStatus)}
        options={getStatusOptions()}
      />
      <SelectField
        label="Funding wallet *"
        value={form.fundingWalletId}
        disabled
        onChange={onFundingWalletChange}
        options={fundingOptions}
      />
      <SelectField
        label="Operational wallet *"
        value={form.operationalWalletId}
        disabled
        onChange={value => onFieldChange('operationalWalletId', value)}
        options={operationalOptions}
      />
      <FullImportPageLink disabled />
      <SelectField
        label="Funding signer device (optional)"
        value={form.signerDeviceId}
        disabled
        onChange={value => onFieldChange('signerDeviceId', value)}
        placeholder="Human wallet signers"
        options={signerOptions}
      />
      <NumberField
        label="Cooldown minutes"
        ariaLabel="Cooldown minutes"
        value={form.cooldownMinutes}
        onChange={value => onFieldChange('cooldownMinutes', value)}
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
          onChange={value => onFieldChange(field.key, value)}
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
          Persist alert history for balance drift, large operational transactions, and repeated rejected funding
          attempts.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MONITORING_SATS_FIELDS.map(field => (
          <NumberField
            key={field.key}
            label={field.label}
            value={form[field.key]}
            onChange={value => onFieldChange(field.key, value)}
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
            onChange={value => onFieldChange(field.key, value)}
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
      <ToggleRow
        label="Human wallet signing required"
        checked={form.requireHumanApproval}
        onChange={onFieldChange.bind(null, 'requireHumanApproval')}
        disabled
      />
      <ToggleRow
        label="Notify on operational spend"
        checked={form.notifyOnOperationalSpend}
        onChange={onFieldChange.bind(null, 'notifyOnOperationalSpend')}
      />
      <ToggleRow
        label="Pause future funding after operational spend"
        checked={form.pauseOnUnexpectedSpend}
        onChange={onFieldChange.bind(null, 'pauseOnUnexpectedSpend')}
        color="warning"
      />
    </div>
  );
}

function AgentFormWarning() {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>
        Agent credentials can only request drafts to verified operational wallet addresses. Once funded, the operational
        wallet can spend without Sanctuary approval.
      </span>
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

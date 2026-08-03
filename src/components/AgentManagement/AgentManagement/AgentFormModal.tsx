import { useEffect, useMemo, useState } from 'react';
import type { AgentManagementOptions, WalletAgentMetadata } from '../../../api/admin';
import { ModalWrapper } from '../../ui/ModalWrapper';
import { createInitialAgentForm, type AgentFormState, type SetAgentFormField } from './formState';
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
} from './formOptions';
import {
  AgentFormActions,
  canAdvanceCreateStep,
  CreateAgentWizardFields,
  EditAgentFormFields,
  FINAL_CREATE_STEP_INDEX,
} from './AgentFormSections';

type AgentFormModalProps = {
  title: string;
  agent?: WalletAgentMetadata;
  options: AgentManagementOptions;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (form: AgentFormState) => Promise<void>;
  onOptionsRefresh?: () => Promise<AgentManagementOptions>;
};

export function AgentFormModal({
  title,
  agent,
  options,
  isSaving,
  onClose,
  onSubmit,
  onOptionsRefresh,
}: AgentFormModalProps) {
  const [form, setForm] = useState<AgentFormState>(() => createInitialAgentForm(agent));
  const [createStepIndex, setCreateStepIndex] = useState(0);
  const selectedFundingWallet = useMemo(
    () => getSelectedFundingWallet(options.wallets, form.fundingWalletId),
    [form.fundingWalletId, options.wallets]
  );
  const fundingWallets = useMemo(() => getFundingWallets(options.wallets, form.userId), [form.userId, options.wallets]);
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
  const canContinue = isEditing ? canSubmit : canAdvanceCreateStep(form, createStepIndex);
  const isFinalCreateStep = createStepIndex === FINAL_CREATE_STEP_INDEX;

  useEffect(() => {
    setForm(current => reconcileAgentFormSelections(current, fundingWallets, operationalWallets, signerDevices));
  }, [
    form.userId,
    form.fundingWalletId,
    form.operationalWalletId,
    form.signerDeviceId,
    fundingWallets,
    operationalWallets,
    signerDevices,
  ]);

  const setField: SetAgentFormField = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const setUser = (userId: string) => {
    setForm(current => setAgentFormUser(current, userId));
  };
  const setFundingWallet = (fundingWalletId: string) => {
    setForm(current => setAgentFormFundingWallet(current, fundingWalletId));
  };
  const handleOperationalWalletImported = async (walletId: string) => {
    await onOptionsRefresh?.();
    setField('operationalWalletId', walletId);
  };
  const handlePrimaryAction = () => {
    if (!isEditing && !isFinalCreateStep) {
      setCreateStepIndex(current => Math.min(current + 1, FINAL_CREATE_STEP_INDEX));
      return;
    }

    void onSubmit(form);
  };
  const handleSecondaryAction = () => {
    if (!isEditing && createStepIndex > 0) {
      setCreateStepIndex(current => Math.max(current - 1, 0));
      return;
    }

    onClose();
  };

  return (
    <ModalWrapper title={title} onClose={onClose} maxWidth="2xl" headerBorder>
      <div className="space-y-4">
        {isEditing ? (
          <EditAgentFormFields
            form={form}
            userOptions={userOptions}
            fundingOptions={fundingOptions}
            operationalOptions={operationalOptions}
            signerOptions={signerOptions}
            onFieldChange={setField}
            onUserChange={setUser}
            onFundingWalletChange={setFundingWallet}
          />
        ) : (
          <CreateAgentWizardFields
            form={form}
            stepIndex={createStepIndex}
            selectedFundingWallet={selectedFundingWallet}
            userOptions={userOptions}
            fundingOptions={fundingOptions}
            operationalOptions={operationalOptions}
            signerOptions={signerOptions}
            onFieldChange={setField}
            onUserChange={setUser}
            onFundingWalletChange={setFundingWallet}
            onOperationalWalletImported={handleOperationalWalletImported}
          />
        )}
      </div>

      <AgentFormActions
        isSaving={isSaving}
        canSubmit={canContinue}
        submitLabel={isEditing || isFinalCreateStep ? (isEditing ? 'Save Agent' : 'Add Agent Wallet') : 'Next'}
        secondaryLabel={!isEditing && createStepIndex > 0 ? 'Back' : 'Cancel'}
        onSecondary={handleSecondaryAction}
        onSubmit={handlePrimaryAction}
      />
    </ModalWrapper>
  );
}

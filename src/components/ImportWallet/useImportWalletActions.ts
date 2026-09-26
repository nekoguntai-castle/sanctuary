import { ApiError } from '../../api/client';
import { createLogger } from '../../utils/logger';
import { buildDescriptorFromXpub, validateImportData } from './importHelpers';
import type { ImportInputSnapshot, ImportNetworkOwner } from './hooks/useImportState';
import type { ImportWalletMutation, ImportWalletState } from './types';

const log = createLogger('ImportWallet');

export function useImportWalletActions({
  state,
  importWalletMutation,
  navigate,
}: {
  state: ImportWalletState;
  importWalletMutation: ImportWalletMutation;
  navigate: (path: string) => void;
}) {
  const renderOwner = state.getNetworkOwner();

  const validateData = async (owner: ImportNetworkOwner, dataOverride?: string) => {
    const snapshot = state.beginValidation(dataOverride);
    state.setIsValidating(true);
    try {
      const valid = await validateImportData(
        snapshot.format,
        snapshot.data,
        state.walletName,
        ownedSetter(state, snapshot, result => state.acceptValidation(snapshot, result)),
        ownedSetter(state, snapshot, state.setValidationError),
        ownedSetter(state, snapshot, state.setWalletName),
        owner.network,
        dataOverride,
      );
      if (!valid || !state.isValidationCurrent(snapshot)) return false;
      state.setStep(3);
      return true;
    } finally {
      if (state.isValidationCurrent(snapshot)) {
        state.setIsValidating(false);
      }
    }
  };

  const handleNext = async () => {
    const owner = renderOwner;
    if (!state.isNetworkOwnerCurrent(owner)) return;

    if (state.step === 1 && state.format) {
      state.setStep(2);
      return;
    }

    if (state.step === 2) {
      await handleStepTwoNext(state, owner, validateData);
      return;
    }

    if (state.step === 3 && state.walletName.trim()) {
      state.setStep(4);
    }
  };

  const handleBack = () => {
    if (state.step <= 3) state.resetValidation();
    if (state.step <= 1) {
      navigate('/wallets');
      return;
    }

    state.setStep(state.step - 1);

    if (state.step === 2) {
      state.resetHardwareState();
      state.resetQrState();
    }
  };

  const handleImport = async () => {
    const owner = renderOwner;
    if (!canSubmitImport(state, owner)) return;

    state.setIsImporting(true);
    state.setImportError(null);

    try {
      const result = await importWalletMutation.mutateAsync({
        // canSubmitImport requires this snapshot to remain current: submit the
        // exact reviewed bytes, never a later value of the editable input.
        data: state.validatedInput!.data,
        name: state.walletName.trim(),
        network: owner.network,
      });

      if (state.isNetworkOwnerCurrent(owner)) {
        navigate(`/wallets/${result.wallet.id}`);
      }
    } catch (error) {
      if (state.isNetworkOwnerCurrent(owner)) {
        log.error('Failed to import wallet', { error });
        state.setImportError(importErrorMessage(error));
      }
    } finally {
      if (state.isNetworkOwnerCurrent(owner)) {
        state.setIsImporting(false);
      }
    }
  };

  return {
    handleBack,
    handleImport,
    handleNext,
  };
}

async function handleStepTwoNext(
  state: ImportWalletState,
  owner: ImportNetworkOwner,
  validateData: (owner: ImportNetworkOwner, dataOverride?: string) => Promise<boolean>,
) {
  if (state.format === 'hardware') {
    await handleHardwareNext(state, owner, validateData);
    return;
  }

  if (state.format === 'qr_code') {
    await validateScannedQr(state, owner, validateData);
    return;
  }

  if (state.importData.trim()) {
    await validateData(owner);
  }
}

async function handleHardwareNext(
  state: ImportWalletState,
  owner: ImportNetworkOwner,
  validateData: (owner: ImportNetworkOwner, dataOverride?: string) => Promise<boolean>,
) {
  if (!state.xpubData) return;

  const descriptor = buildDescriptorFromXpub(
    state.scriptType,
    state.xpubData.fingerprint,
    state.xpubData.path,
    state.xpubData.xpub,
  );

  state.setImportData(descriptor);
  await validateData(owner, descriptor);
}

async function validateScannedQr(
  state: ImportWalletState,
  owner: ImportNetworkOwner,
  validateData: (owner: ImportNetworkOwner, dataOverride?: string) => Promise<boolean>,
) {
  if (state.qrScanned && state.importData.trim()) {
    await validateData(owner);
  }
}

function ownedSetter<T>(
  state: ImportWalletState,
  owner: ImportInputSnapshot,
  setter: (value: T) => void,
): (value: T) => void {
  return (value) => {
    if (state.isValidationCurrent(owner)) setter(value);
  };
}

function canSubmitImport(state: ImportWalletState, owner: ImportNetworkOwner): boolean {
  return state.step === 4
    && Boolean(state.validationResult)
    && state.validatedInput !== null
    && state.isValidationCurrent(state.validatedInput)
    && !state.isValidating
    && !state.isImporting
    && Boolean(state.importData.trim())
    && Boolean(state.walletName.trim())
    && state.isNetworkOwnerCurrent(owner);
}

function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Failed to import wallet. Please try again.';
}

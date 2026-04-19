import { ApiError } from '../../src/api/client';
import { createLogger } from '../../utils/logger';
import { buildDescriptorFromXpub, validateImportData } from './importHelpers';
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
  const validateData = async (dataOverride?: string) => {
    state.setIsValidating(true);
    try {
      return await validateImportData(
        state.format,
        state.importData,
        state.walletName,
        state.setValidationResult,
        state.setValidationError,
        state.setWalletName,
        dataOverride,
      );
    } finally {
      state.setIsValidating(false);
    }
  };

  const handleNext = async () => {
    if (state.step === 1 && state.format) {
      state.setStep(2);
      return;
    }

    if (state.step === 2) {
      await handleStepTwoNext(state, validateData);
      return;
    }

    if (state.step === 3 && state.walletName.trim()) {
      state.setStep(4);
    }
  };

  const handleBack = () => {
    if (state.step <= 1) {
      navigate('/wallets');
      return;
    }

    state.setStep(state.step - 1);

    if (state.step === 3) {
      state.resetValidation();
    }

    if (state.step === 2) {
      state.resetHardwareState();
      state.resetQrState();
    }
  };

  const handleImport = async () => {
    state.setIsImporting(true);
    state.setImportError(null);

    try {
      const result = await importWalletMutation.mutateAsync({
        data: state.importData,
        name: state.walletName.trim(),
        network: state.network,
      });

      navigate(`/wallets/${result.wallet.id}`);
    } catch (error) {
      log.error('Failed to import wallet', { error });
      state.setImportError(importErrorMessage(error));
    } finally {
      state.setIsImporting(false);
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
  validateData: (dataOverride?: string) => Promise<boolean>,
) {
  if (state.format === 'hardware') {
    await handleHardwareNext(state, validateData);
    return;
  }

  if (state.format === 'qr_code') {
    await validateScannedQr(state, validateData);
    return;
  }

  if (state.importData.trim()) {
    await validateAndAdvance(state, validateData);
  }
}

async function handleHardwareNext(
  state: ImportWalletState,
  validateData: (dataOverride?: string) => Promise<boolean>,
) {
  if (!state.xpubData) return;

  const descriptor = buildDescriptorFromXpub(
    state.scriptType,
    state.xpubData.fingerprint,
    state.xpubData.path,
    state.xpubData.xpub,
  );

  state.setImportData(descriptor);
  await validateAndAdvance(state, validateData, descriptor);
}

async function validateScannedQr(
  state: ImportWalletState,
  validateData: (dataOverride?: string) => Promise<boolean>,
) {
  if (state.qrScanned && state.importData.trim()) {
    await validateAndAdvance(state, validateData);
  }
}

async function validateAndAdvance(
  state: ImportWalletState,
  validateData: (dataOverride?: string) => Promise<boolean>,
  dataOverride?: string,
) {
  const isValid = await validateData(dataOverride);
  if (isValid) {
    state.setStep(3);
  }
}

function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Failed to import wallet. Please try again.';
}

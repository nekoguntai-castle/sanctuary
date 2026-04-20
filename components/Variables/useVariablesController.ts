import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as adminApi from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import {
  parseConfirmationThreshold,
  parseDeepConfirmationThreshold,
  parseDustThreshold,
  resolveVariableThresholds,
  validateThresholds,
} from './settingsModel';
import type { VariablesController } from './types';

export function useVariablesController(): VariablesController {
  const [confirmationThreshold, setConfirmationThreshold] = useState(1);
  const [deepConfirmationThreshold, setDeepConfirmationThreshold] = useState(3);
  const [dustThreshold, setDustThreshold] = useState(546);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isSaving, error: saveError, execute: runSave } = useLoadingState();

  useEffect(() => clearSuccessTimeoutOnUnmount(successTimeoutRef), []);

  useEffect(() => {
    void runLoad(async () => {
      const settings = await adminApi.getSystemSettings();
      const thresholds = resolveVariableThresholds(settings);

      setConfirmationThreshold(thresholds.confirmationThreshold);
      setDeepConfirmationThreshold(thresholds.deepConfirmationThreshold);
      setDustThreshold(thresholds.dustThreshold);
    });
  }, [runLoad]);

  const thresholds = {
    confirmationThreshold,
    deepConfirmationThreshold,
    dustThreshold,
  };

  const handleSave = async () => {
    const nextValidationError = validateThresholds(thresholds);

    if (nextValidationError) {
      setValidationError(nextValidationError);
      return;
    }

    setValidationError(null);

    const result = await runSave(async () => {
      await adminApi.updateSystemSettings(thresholds);
    });

    if (result !== null) {
      showSaveSuccess(setSaveSuccess, successTimeoutRef);
    }
  };

  return {
    loading,
    confirmationThreshold,
    deepConfirmationThreshold,
    dustThreshold,
    saveSuccess,
    displayError: validationError || saveError,
    isSaving,
    handleConfirmationThresholdChange: (value) => setConfirmationThreshold(parseConfirmationThreshold(value)),
    handleDeepConfirmationThresholdChange: (value) => setDeepConfirmationThreshold(parseDeepConfirmationThreshold(value)),
    handleDustThresholdChange: (value) => setDustThreshold(parseDustThreshold(value)),
    handleSave,
  };
}

function clearSuccessTimeoutOnUnmount(successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  return () => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
  };
}

function showSaveSuccess(
  setSaveSuccess: (saveSuccess: boolean) => void,
  successTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
) {
  setSaveSuccess(true);

  if (successTimeoutRef.current) {
    clearTimeout(successTimeoutRef.current);
  }

  successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
}

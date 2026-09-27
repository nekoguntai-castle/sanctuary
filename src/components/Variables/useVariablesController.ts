import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as adminApi from '../../api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { useLatestRequest } from '../../hooks/useLatestRequest';
import { extractErrorMessage } from '../../utils/errorHandler';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Placeholder defaults must not be saved before a successful settings read.
  const baselineReady = useRef(false);
  const loadOwner = useLatestRequest();
  const { loading: isSaving, error: saveError, execute: runSave } = useLoadingState();

  useEffect(() => clearSuccessTimeoutOnUnmount(successTimeoutRef), []);

  const retryLoad = useCallback(async () => {
    const token = loadOwner.begin();
    baselineReady.current = false;
    setLoading(true);
    setLoadError(null);
    try {
      const settings = await adminApi.getSystemSettings();
      if (!loadOwner.isCurrent(token)) return;
      const thresholds = resolveVariableThresholds(settings);
      setConfirmationThreshold(thresholds.confirmationThreshold);
      setDeepConfirmationThreshold(thresholds.deepConfirmationThreshold);
      setDustThreshold(thresholds.dustThreshold);
      baselineReady.current = true;
    } catch (error) {
      if (loadOwner.isCurrent(token)) {
        setLoadError(extractErrorMessage(error, 'Settings are unavailable'));
      }
    } finally {
      if (loadOwner.isCurrent(token)) setLoading(false);
    }
  }, [loadOwner]);

  useEffect(() => {
    void retryLoad();
  }, [retryLoad]);

  const thresholds = {
    confirmationThreshold,
    deepConfirmationThreshold,
    dustThreshold,
  };

  const handleSave = async () => {
    // The view shows loading or Retry instead of Save until the baseline is known.
    if (!baselineReady.current) return;
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
    loadError,
    retryLoad,
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

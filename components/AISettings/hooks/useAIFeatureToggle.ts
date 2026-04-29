/**
 * Hook for enabling/disabling AI features.
 *
 * Provider runtimes are managed outside Sanctuary; this hook only persists the
 * feature toggle and owns the confirmation modal state.
 */

import { useState } from "react";
import * as adminApi from "../../../src/api/admin";
import { createLogger } from "../../../utils/logger";
import { invalidateAIStatusCache } from "../../../hooks/useAIStatus";

const log = createLogger("AISettings:useAIFeatureToggle");

interface UseAIFeatureToggleParams {
  aiEnabled: boolean;
  setAiEnabled: (value: boolean) => void;
}

interface UseAIFeatureToggleReturn {
  handleToggleAI: () => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  showEnableModal: boolean;
  handleCloseEnableModal: () => void;
  performToggleAI: (newValue: boolean) => Promise<void>;
}

export function useAIFeatureToggle({
  aiEnabled,
  setAiEnabled,
}: UseAIFeatureToggleParams): UseAIFeatureToggleReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showEnableModal, setShowEnableModal] = useState(false);

  const handleCloseEnableModal = () => {
    setShowEnableModal(false);
  };

  const handleToggleAI = async () => {
    if (!aiEnabled) {
      setShowEnableModal(true);
      return;
    }

    await performToggleAI(false);
  };

  const performToggleAI = async (newValue: boolean) => {
    setShowEnableModal(false);
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await adminApi.updateSystemSettings({ aiEnabled: newValue });
      setAiEnabled(newValue);
      invalidateAIStatusCache();

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 5000);
    } catch (error) {
      log.error("Failed to toggle AI", { error });
      setSaveError("Failed to update AI settings");
    } finally {
      setIsSaving(false);
    }
  };

  return {
    handleToggleAI,
    isSaving,
    saveError,
    saveSuccess,
    showEnableModal,
    handleCloseEnableModal,
    performToggleAI,
  };
}

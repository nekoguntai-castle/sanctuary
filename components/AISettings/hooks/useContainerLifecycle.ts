/**
 * Hook for container lifecycle management
 *
 * Handles starting/stopping the Ollama container, the enable/disable toggle
 * (including the confirmation modal flow), and auto-detection after container start.
 */

import { useState } from 'react';
import * as adminApi from '../../../src/api/admin';
import * as aiApi from '../../../src/api/ai';
import { createLogger } from '../../../utils/logger';
import { extractErrorMessage } from '../../../utils/errorHandler';
import { invalidateAIStatusCache } from '../../../hooks/useAIStatus';

const log = createLogger('AISettings:useContainerLifecycle');

interface UseContainerLifecycleParams {
  aiEnabled: boolean;
  setAiEnabled: (value: boolean) => void;
  setAiEndpoint: (value: string) => void;
  setAiModel: (value: string) => void;
  containerStatus: aiApi.OllamaContainerStatus | null;
  setContainerStatus: (status: aiApi.OllamaContainerStatus | null) => void;
  loadModels: () => Promise<void>;
}

interface UseContainerLifecycleReturn {
  // Container operations
  isStartingContainer: boolean;
  containerMessage: string;
  handleStartContainer: () => Promise<void>;
  handleStopContainer: () => Promise<void>;
  refreshContainerStatus: () => Promise<void>;

  // Toggle AI (enable/disable)
  handleToggleAI: () => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;

  // Enable modal
  showEnableModal: boolean;
  systemResources: aiApi.SystemResources | null;
  isLoadingResources: boolean;
  acknowledgeInsufficient: boolean;
  setAcknowledgeInsufficient: (value: boolean) => void;
  handleCloseEnableModal: () => void;
  performToggleAI: (newValue: boolean) => Promise<void>;
}

export function toRunningContainerStatus(
  containerStatus: aiApi.OllamaContainerStatus | null
): aiApi.OllamaContainerStatus | null {
  return containerStatus
    ? { ...containerStatus, exists: true, running: true, status: 'running' }
    : null;
}

export function useContainerLifecycle({
  aiEnabled,
  setAiEnabled,
  setAiEndpoint,
  setAiModel,
  containerStatus,
  setContainerStatus,
  loadModels,
}: UseContainerLifecycleParams): UseContainerLifecycleReturn {
  // Container state
  const [isStartingContainer, setIsStartingContainer] = useState(false);
  const [containerMessage, setContainerMessage] = useState('');

  // Toggle save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Enable confirmation modal state
  const [showEnableModal, setShowEnableModal] = useState(false);
  const [systemResources, setSystemResources] = useState<aiApi.SystemResources | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [acknowledgeInsufficient, setAcknowledgeInsufficient] = useState(false);

  const refreshContainerStatus = async () => {
    try {
      const status = await aiApi.getOllamaContainerStatus();
      setContainerStatus(status);
    } catch (error) {
      log.error('Failed to refresh container status', { error });
    }
  };

  // Open the enable confirmation modal and fetch system resources
  const handleOpenEnableModal = async () => {
    setShowEnableModal(true);
    setIsLoadingResources(true);
    setAcknowledgeInsufficient(false);
    setSystemResources(null);

    try {
      const resources = await aiApi.getSystemResources();
      setSystemResources(resources);
    } catch (error) {
      log.error('Failed to fetch system resources', { error });
      // Still allow enabling even if resource check fails
      setSystemResources(null);
    } finally {
      setIsLoadingResources(false);
    }
  };

  const handleCloseEnableModal = () => {
    setShowEnableModal(false);
    setSystemResources(null);
    setAcknowledgeInsufficient(false);
  };

  // Called when user clicks the toggle — just enables/disables the feature
  // without starting containers (user can start the container separately)
  const handleToggleAI = async () => {
    if (!aiEnabled) {
      // Enabling - show confirmation modal first
      handleOpenEnableModal();
      return;
    }

    // Disabling - proceed directly
    await performToggleAI(false);
  };

  // Actually perform the enable/disable action
  const performToggleAI = async (newValue: boolean) => {
    setShowEnableModal(false);
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setContainerMessage('');

    try {
      // Enable/disable the AI setting — no container management here
      await adminApi.updateSystemSettings({ aiEnabled: newValue });
      setAiEnabled(newValue);
      invalidateAIStatusCache(); // Refresh AI status across the app

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setContainerMessage('');
      }, 5000);
    } catch (error) {
      log.error('Failed to toggle AI', { error });
      setSaveError('Failed to update AI settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartContainer = async () => {
    setIsStartingContainer(true);
    setContainerMessage('Starting AI container...');

    try {
      const result = await aiApi.startOllamaContainer();
      if (result.success) {
        setContainerMessage('Container started! Waiting for Ollama to be ready...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await refreshContainerStatus();

        // Auto-detect after starting
        setContainerMessage('Detecting Ollama endpoint...');
        const detectResult = await aiApi.detectOllama();
        if (detectResult.found && detectResult.endpoint) {
          setAiEndpoint(detectResult.endpoint);
          if (detectResult.models && detectResult.models.length > 0) {
            setAiModel(detectResult.models[0]);
            setContainerMessage(`Connected with ${detectResult.models[0]}`);
          } else {
            setContainerMessage('Connected! Go to the Models tab to pull a model.');
          }
          setTimeout(loadModels, 500);
        } else {
          setContainerMessage('Container running. Click Detect to configure.');
        }
      } else {
        setContainerMessage(`Failed: ${result.message}`);
      }
    } catch (error) {
      log.error('Failed to start container', { error });
      setContainerMessage(`Error: ${extractErrorMessage(error, 'Failed to start')}`);
    } finally {
      setIsStartingContainer(false);
      setTimeout(() => setContainerMessage(''), 8000);
    }
  };

  const handleStopContainer = async () => {
    setContainerMessage('Stopping AI container...');

    try {
      const result = await aiApi.stopOllamaContainer();
      if (result.success) {
        setContainerMessage('Container stopped');
        await refreshContainerStatus();
      } else {
        setContainerMessage(`Failed: ${result.message}`);
      }
    } catch (error) {
      log.error('Failed to stop container', { error });
      setContainerMessage(`Error: ${extractErrorMessage(error, 'Failed to stop')}`);
    } finally {
      setTimeout(() => setContainerMessage(''), 5000);
    }
  };

  return {
    isStartingContainer,
    containerMessage,
    handleStartContainer,
    handleStopContainer,
    refreshContainerStatus,
    handleToggleAI,
    isSaving,
    saveError,
    saveSuccess,
    showEnableModal,
    systemResources,
    isLoadingResources,
    acknowledgeInsufficient,
    setAcknowledgeInsufficient,
    handleCloseEnableModal,
    performToggleAI,
  };
}

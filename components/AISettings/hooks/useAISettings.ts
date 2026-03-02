/**
 * Hook for AI settings state and persistence
 *
 * Manages loading/saving of AI configuration (enabled, endpoint, model)
 * and auto-detection of Ollama instances.
 */

import { useState, useEffect, useCallback } from 'react';
import * as adminApi from '../../../src/api/admin';
import * as aiApi from '../../../src/api/ai';
import { createLogger } from '../../../utils/logger';

const log = createLogger('AISettings:useAISettings');

interface UseAISettingsReturn {
  // State
  aiEnabled: boolean;
  setAiEnabled: (value: boolean) => void;
  aiEndpoint: string;
  setAiEndpoint: (value: string) => void;
  aiModel: string;
  setAiModel: (value: string) => void;
  loading: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  isDetecting: boolean;
  detectMessage: string;
  containerStatus: aiApi.OllamaContainerStatus | null;
  setContainerStatus: (status: aiApi.OllamaContainerStatus | null) => void;

  // Handlers
  handleSaveConfig: () => Promise<void>;
  handleDetectOllama: () => Promise<void>;
  loadModels: () => Promise<void>;

  // Model list (loaded alongside settings)
  availableModels: aiApi.OllamaModel[];
  isLoadingModels: boolean;
  showModelDropdown: boolean;
  setShowModelDropdown: (value: boolean) => void;
  handleSelectModel: (modelName: string) => void;
}

export function useAISettings(): UseAISettingsReturn {
  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState('');
  const [aiModel, setAiModel] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState('');

  // Container state (loaded with settings)
  const [containerStatus, setContainerStatus] = useState<aiApi.OllamaContainerStatus | null>(null);

  // Models state
  const [availableModels, setAvailableModels] = useState<aiApi.OllamaModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const loadModels = useCallback(async () => {
    if (!aiEndpoint) return;

    setIsLoadingModels(true);
    try {
      const result = await aiApi.listModels();
      setAvailableModels(result.models || []);
    } catch (error) {
      log.error('Failed to load models', { error });
    } finally {
      setIsLoadingModels(false);
    }
  }, [aiEndpoint]);

  // Load settings and container status on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settings, containerResult] = await Promise.all([
          adminApi.getSystemSettings(),
          aiApi.getOllamaContainerStatus().catch(() => null),
        ]);
        setAiEnabled(settings.aiEnabled || false);
        setAiEndpoint(settings.aiEndpoint || '');
        setAiModel(settings.aiModel || '');
        if (containerResult) {
          setContainerStatus(containerResult);
        }
      } catch (error) {
        log.error('Failed to load AI settings', { error });
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  // Load models when endpoint changes
  useEffect(() => {
    if (aiEndpoint && aiEnabled) {
      loadModels();
    }
  }, [aiEndpoint, aiEnabled, loadModels]);

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await adminApi.updateSystemSettings({
        aiEndpoint,
        aiModel,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Reload models after saving
      loadModels();
    } catch (error) {
      log.error('Failed to save AI configuration', { error });
      setSaveError('Failed to save AI configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetectOllama = async () => {
    setIsDetecting(true);
    setDetectMessage('Searching for Ollama...');

    try {
      const result = await aiApi.detectOllama();
      if (result.found && result.endpoint) {
        setAiEndpoint(result.endpoint);

        // Auto-save the endpoint to database
        await adminApi.updateSystemSettings({ aiEndpoint: result.endpoint });

        // If models were detected, show them and auto-select first
        if (result.models && result.models.length > 0) {
          setDetectMessage(`Found Ollama with ${result.models.length} model(s) - saved!`);
          if (!aiModel && result.models.length > 0) {
            const firstModel = result.models[0];
            setAiModel(firstModel);
            await adminApi.updateSystemSettings({ aiModel: firstModel });
          }
        } else {
          setDetectMessage(`Found Ollama at ${result.endpoint} - saved!`);
        }
        // Reload models list
        setTimeout(loadModels, 500);
      } else {
        setDetectMessage(result.message || 'Ollama not found. Is it running?');
      }
    } catch (error) {
      log.error('Ollama detection failed', { error });
      setDetectMessage('Detection failed. Check AI container logs.');
    } finally {
      setIsDetecting(false);
      setTimeout(() => setDetectMessage(''), 5000);
    }
  };

  const handleSelectModel = (modelName: string) => {
    setAiModel(modelName);
    setShowModelDropdown(false);
  };

  return {
    aiEnabled,
    setAiEnabled,
    aiEndpoint,
    setAiEndpoint,
    aiModel,
    setAiModel,
    loading,
    isSaving,
    saveError,
    saveSuccess,
    isDetecting,
    detectMessage,
    containerStatus,
    setContainerStatus,
    handleSaveConfig,
    handleDetectOllama,
    loadModels,
    availableModels,
    isLoadingModels,
    showModelDropdown,
    setShowModelDropdown,
    handleSelectModel,
  };
}

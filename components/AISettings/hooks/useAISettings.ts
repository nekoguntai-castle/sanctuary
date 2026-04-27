/**
 * Hook for AI settings state and persistence
 *
 * Manages loading/saving of AI configuration (enabled, endpoint, model)
 * and auto-detection of Ollama instances.
 */

import { useState, useEffect, useCallback } from 'react';
import * as adminApi from '../../../src/api/admin';
import * as aiApi from '../../../src/api/ai';
import { ApiError } from '../../../src/api/client';
import { createLogger } from '../../../utils/logger';
import type { AIProviderCapabilities, AIProviderType } from '../../../src/api/admin';
import {
  createProviderProfile,
  normalizeProviderProfiles,
  replaceProviderProfile,
  stripProviderCredentialState,
  type EditableProviderProfile,
} from '../providerProfileModel';

const log = createLogger('AISettings:useAISettings');

interface UseAISettingsReturn {
  // State
  featureUnavailable: boolean;
  providerProfiles: EditableProviderProfile[];
  activeProviderProfileId: string;
  providerName: string;
  setProviderName: (value: string) => void;
  providerType: AIProviderType;
  setProviderType: (value: AIProviderType) => void;
  providerCapabilities: AIProviderCapabilities;
  credentialApiKey: string;
  setCredentialApiKey: (value: string) => void;
  clearCredential: boolean;
  setClearCredential: (value: boolean) => void;
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
  handleSelectProviderProfile: (profileId: string) => void;
  handleAddProviderProfile: () => void;
  handleRemoveActiveProviderProfile: () => void;
  handleProviderCapabilityChange: (capability: keyof AIProviderCapabilities, value: boolean) => void;

  // Model list (loaded alongside settings)
  availableModels: aiApi.OllamaModel[];
  isLoadingModels: boolean;
  showModelDropdown: boolean;
  setShowModelDropdown: (value: boolean) => void;
  handleSelectModel: (modelName: string) => void;
}

export function useAISettings(): UseAISettingsReturn {
  // Feature flag state
  const [featureUnavailable, setFeatureUnavailable] = useState(false);

  const [providerProfiles, setProviderProfiles] = useState<EditableProviderProfile[]>([]);
  const [activeProviderProfileId, setActiveProviderProfileId] = useState('default-ollama');
  const [providerName, setProviderName] = useState('Default Ollama');
  const [providerType, setProviderType] = useState<AIProviderType>('ollama');
  const [providerCapabilities, setProviderCapabilities] = useState<AIProviderCapabilities>({
    chat: true,
    toolCalls: false,
    strictJson: true,
  });
  const [credentialApiKey, setCredentialApiKey] = useState('');
  const [clearCredential, setClearCredential] = useState(false);

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

  const applyProviderProfile = useCallback((profile: EditableProviderProfile) => {
    setActiveProviderProfileId(profile.id);
    setProviderName(profile.name);
    setProviderType(profile.providerType);
    setProviderCapabilities(profile.capabilities);
    setAiEndpoint(profile.endpoint);
    setAiModel(profile.model);
    setCredentialApiKey('');
    setClearCredential(false);
  }, []);

  const applySettingsResponse = useCallback((settings: adminApi.SystemSettings) => {
    const providerState = normalizeProviderProfiles(settings);
    setProviderProfiles(providerState.profiles);
    applyProviderProfile(providerState.activeProfile);
    setAiEnabled(settings.aiEnabled || false);
  }, [applyProviderProfile]);

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
        // Check if the aiAssistant feature flag is enabled
        const flags = await adminApi.getFeatureFlags();
        const aiFlag = flags.find(f => f.key === 'aiAssistant');
        if (aiFlag && !aiFlag.enabled) {
          setFeatureUnavailable(true);
          setLoading(false);
          return;
        }
      } catch (err) {
        // If we get a 403, the feature flags endpoint itself is gated
        if (err instanceof ApiError && err.status === 403) {
          setFeatureUnavailable(true);
          setLoading(false);
          return;
        }
        // Otherwise continue — flag check is best-effort
      }

      try {
        const [settings, containerResult] = await Promise.all([
          adminApi.getSystemSettings(),
          aiApi.getOllamaContainerStatus().catch(() => null),
        ]);
        applySettingsResponse(settings);
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
  }, [applySettingsResponse]);

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
      const activeProfile = {
        id: activeProviderProfileId,
        name: providerName.trim() || 'Unnamed provider',
        providerType,
        endpoint: aiEndpoint.trim(),
        model: aiModel.trim(),
        capabilities: providerCapabilities,
      };
      const nextProfiles = replaceProviderProfile(providerProfiles, activeProfile)
        .map(stripProviderCredentialState);
      const credentialUpdate =
        credentialApiKey || clearCredential
          ? [{
              profileId: activeProfile.id,
              type: 'api-key' as const,
              apiKey: credentialApiKey,
              clear: clearCredential,
            }]
          : undefined;
      const nextSettings = await adminApi.updateSystemSettings({
        aiEndpoint: activeProfile.endpoint,
        aiModel: activeProfile.model,
        aiProviderProfiles: nextProfiles,
        aiActiveProviderProfileId: activeProfile.id,
        ...(credentialUpdate ? { aiProviderCredentialUpdates: credentialUpdate } : {}),
      });
      applySettingsResponse(nextSettings);
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

  const handleSelectProviderProfile = (profileId: string) => {
    const activeProfile = providerProfiles.find((profile) => profile.id === profileId);
    if (activeProfile) {
      applyProviderProfile(activeProfile);
    }
  };

  const handleAddProviderProfile = () => {
    const profile = createProviderProfile(`provider-${Date.now().toString(36)}`);
    setProviderProfiles((profiles) => [...profiles, profile]);
    applyProviderProfile(profile);
  };

  const handleRemoveActiveProviderProfile = () => {
    if (providerProfiles.length <= 1) return;
    const nextProfiles = providerProfiles.filter((profile) => profile.id !== activeProviderProfileId);
    const fallbackProfile = nextProfiles[0]!;
    setProviderProfiles(nextProfiles);
    applyProviderProfile(fallbackProfile);
  };

  const handleProviderCapabilityChange = (
    capability: keyof AIProviderCapabilities,
    value: boolean,
  ) => {
    setProviderCapabilities((capabilities) => ({
      ...capabilities,
      [capability]: value,
    }));
  };

  return {
    featureUnavailable,
    providerProfiles,
    activeProviderProfileId,
    providerName,
    setProviderName,
    providerType,
    setProviderType,
    providerCapabilities,
    credentialApiKey,
    setCredentialApiKey,
    clearCredential,
    setClearCredential,
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
    handleSelectProviderProfile,
    handleAddProviderProfile,
    handleRemoveActiveProviderProfile,
    handleProviderCapabilityChange,
    availableModels,
    isLoadingModels,
    showModelDropdown,
    setShowModelDropdown,
    handleSelectModel,
  };
}

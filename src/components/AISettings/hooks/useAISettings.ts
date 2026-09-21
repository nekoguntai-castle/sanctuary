/**
 * Hook for AI settings state and persistence
 *
 * Manages loading/saving of AI configuration (enabled, endpoint, model)
 * and auto-detection of Ollama instances.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import * as adminApi from "../../../api/admin";
import * as aiApi from "../../../api/ai";
import { createLogger } from "../../../utils/logger";
import type {
  AIProviderCapabilities,
  AIProviderType,
} from "../../../api/admin";
import {
  createProviderProfile,
  normalizeProviderProfiles,
  type EditableProviderProfile,
} from "../providerProfileModel";
import {
  buildActiveProviderProfile,
  buildCredentialUpdate,
  buildProviderSettingsUpdate,
  providerLabel,
} from "../providerSettingsUpdate";
import {
  getApiDisplayMessage,
  modelSourceFromProfile,
  useConfiguredModelDiscovery,
} from "./useConfiguredModelDiscovery";
import type { AISettingsController } from "../types";
import { useAISettingsBootstrap } from "./useAISettingsBootstrap";
import { useOrderedSettingsMutation } from "./useOrderedSettingsMutation";

const log = createLogger("AISettings:useAISettings");

export function useAISettings(): AISettingsController {
  // Feature flag state
  const [featureUnavailable, setFeatureUnavailable] = useState(false);

  const [providerProfiles, setProviderProfiles] = useState<
    EditableProviderProfile[]
  >([]);
  const [activeProviderProfileId, setActiveProviderProfileId] =
    useState("default-ollama");
  const [providerName, setProviderNameState] = useState("Default Ollama");
  const [providerType, setProviderTypeState] =
    useState<AIProviderType>("ollama");
  const [providerCapabilities, setProviderCapabilities] =
    useState<AIProviderCapabilities>({
      chat: true,
      toolCalls: false,
      strictJson: true,
    });
  const [credentialApiKey, setCredentialApiKeyState] = useState("");
  const [clearCredential, setClearCredentialState] = useState(false);

  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpointState] = useState("");
  const [aiModel, setAiModelState] = useState("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState("");

  const handleModelLoadError = useCallback(
    (message: string) => setDetectMessage(message),
    [],
  );
  const modelDiscovery = useConfiguredModelDiscovery(handleModelLoadError);
  const updateSystemSettings = useOrderedSettingsMutation();
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const detectMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const detectionGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);

  const clearSaveSuccessTimeout = useCallback(() => {
    if (saveSuccessTimeoutRef.current) {
      clearTimeout(saveSuccessTimeoutRef.current);
      saveSuccessTimeoutRef.current = null;
    }
  }, []);

  const clearDetectMessageTimeout = useCallback(() => {
    if (detectMessageTimeoutRef.current) {
      clearTimeout(detectMessageTimeoutRef.current);
      detectMessageTimeoutRef.current = null;
    }
  }, []);

  const invalidateDetection = useCallback(() => {
    detectionGenerationRef.current += 1;
    setIsDetecting(false);
    setDetectMessage("");
    clearDetectMessageTimeout();
  }, [clearDetectMessageTimeout]);

  const invalidateSave = useCallback(() => {
    saveGenerationRef.current += 1;
    setIsSaving(false);
  }, []);

  const applyProviderProfile = useCallback(
    (profile: EditableProviderProfile) => {
      setActiveProviderProfileId(profile.id);
      setProviderNameState(profile.name);
      setProviderTypeState(profile.providerType);
      setProviderCapabilities(profile.capabilities);
      setAiEndpointState(profile.endpoint);
      setAiModelState(profile.model);
      setCredentialApiKeyState("");
      setClearCredentialState(false);
      modelDiscovery.updateVisibleSource(modelSourceFromProfile(profile));
    },
    [modelDiscovery.updateVisibleSource],
  );

  const applySettingsResponse = useCallback(
    (settings: adminApi.SystemSettings) => {
      const providerState = normalizeProviderProfiles(settings);
      setProviderProfiles(providerState.profiles);
      applyProviderProfile(providerState.activeProfile);
      setAiEnabled(settings.aiEnabled || false);
      return modelDiscovery.bindPersistedSource(
        modelSourceFromProfile(providerState.activeProfile),
      );
    },
    [applyProviderProfile, modelDiscovery.bindPersistedSource],
  );

  const currentProviderFields = () => ({
    id: activeProviderProfileId,
    name: providerName,
    providerType,
    endpoint: aiEndpoint,
    model: aiModel,
    capabilities: providerCapabilities,
  });

  useAISettingsBootstrap({
    applySettingsResponse,
    loadModelsFromSource: modelDiscovery.loadModelsFromSource,
    setFeatureUnavailable,
    setLoading,
  });

  useEffect(
    () => () => {
      detectionGenerationRef.current += 1;
      saveGenerationRef.current += 1;
      clearSaveSuccessTimeout();
      clearDetectMessageTimeout();
    },
    [clearDetectMessageTimeout, clearSaveSuccessTimeout],
  );

  const setProviderType = (value: AIProviderType) => {
    invalidateDetection();
    invalidateSave();
    setProviderTypeState(value);
    modelDiscovery.updateVisibleSource({ providerType: value });
  };

  const setProviderName = (value: string) => {
    invalidateDetection();
    invalidateSave();
    setProviderNameState(value);
  };

  const setAiEndpoint = (value: string) => {
    invalidateDetection();
    invalidateSave();
    setAiEndpointState(value);
    modelDiscovery.updateVisibleSource({ endpoint: value });
  };

  const setAiModel = (value: string) => {
    invalidateDetection();
    invalidateSave();
    setAiModelState(value);
  };

  const setCredentialApiKey = (value: string) => {
    invalidateDetection();
    invalidateSave();
    setCredentialApiKeyState(value);
    modelDiscovery.updateVisibleSource({
      credentialEdited: Boolean(value) || clearCredential,
    });
  };

  const setClearCredential = (value: boolean) => {
    invalidateDetection();
    invalidateSave();
    setClearCredentialState(value);
    modelDiscovery.updateVisibleSource({
      credentialEdited: value || Boolean(credentialApiKey),
    });
  };

  const handleSaveConfig = async () => {
    invalidateDetection();
    invalidateSave();
    const generation = saveGenerationRef.current;
    modelDiscovery.clearDiscovery();
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const activeProfile = buildActiveProviderProfile(currentProviderFields());
      const nextSettings = await updateSystemSettings(
        buildProviderSettingsUpdate(
          providerProfiles,
          activeProfile,
          buildCredentialUpdate(
            activeProfile.id,
            credentialApiKey,
            clearCredential,
          ),
        ),
      );
      if (saveGenerationRef.current !== generation) return;
      const source = applySettingsResponse(nextSettings);
      setSaveSuccess(true);
      clearSaveSuccessTimeout();
      saveSuccessTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimeoutRef.current = null;
      }, 3000);
      await modelDiscovery.loadModelsFromSource(source);
    } catch (error) {
      if (saveGenerationRef.current !== generation) return;
      log.error("Failed to save AI configuration", { error });
      setSaveError("Failed to save AI configuration");
    } finally {
      if (saveGenerationRef.current === generation) setIsSaving(false);
    }
  };

  const persistTypedDetection = async (
    generation: number,
    profile: EditableProviderProfile,
    models: aiApi.ProviderModel[],
    credentialUpdate?: adminApi.AIProviderCredentialUpdate[],
  ) => {
    const selectedModel = aiModel.trim() || models[0]?.name || "";
    if (!aiModel.trim() && selectedModel) setAiModelState(selectedModel);
    const nextSettings = await updateSystemSettings(
      buildProviderSettingsUpdate(
        providerProfiles,
        { ...profile, model: selectedModel },
        credentialUpdate,
      ),
    );
    if (detectionGenerationRef.current !== generation) return;
    const source = applySettingsResponse(nextSettings);
    await modelDiscovery.loadModelsFromSource(source);
    if (detectionGenerationRef.current !== generation) return;

    setDetectMessage(
      models.length === 0
        ? "Connected to provider endpoint, but no models were reported. Enter the model name manually, then save."
        : `Connected to ${providerLabel(profile.providerType)} endpoint with ${models.length} model(s) - saved!`,
    );
  };

  const handleDetectTypedProvider = async (generation: number) => {
    const endpoint = aiEndpoint.trim();
    if (!endpoint) {
      setDetectMessage("Enter an AI endpoint URL first.");
      return;
    }

    const result = await aiApi.detectProvider({
      endpoint,
      preferredProviderType: providerType,
      ...(credentialApiKey ? { apiKey: credentialApiKey } : {}),
    });
    if (detectionGenerationRef.current !== generation) return;
    if (!result.found) {
      modelDiscovery.setDetectedModels([]);
      setDetectMessage(result.message || "Provider endpoint not reachable.");
      return;
    }

    const detectedProviderType = result.providerType ?? providerType;
    if (detectedProviderType !== providerType) {
      setProviderTypeState(detectedProviderType);
      modelDiscovery.updateVisibleSource({
        providerType: detectedProviderType,
      });
    }
    const models = result.models || [];
    modelDiscovery.setDetectedModels(models);

    const detectedEndpoint = result.endpoint ?? endpoint;
    const profile = buildActiveProviderProfile(currentProviderFields(), {
      endpoint: detectedEndpoint,
    });
    const profileToSave = {
      ...profile,
      providerType: detectedProviderType,
    };
    const credentialUpdate =
      credentialApiKey || clearCredential
        ? buildCredentialUpdate(
            profileToSave.id,
            credentialApiKey,
            clearCredential,
          )
        : undefined;
    await persistTypedDetection(
      generation,
      profileToSave,
      models,
      credentialUpdate,
    );
  };

  const handleDetectOllama = async () => {
    invalidateDetection();
    invalidateSave();
    const generation = detectionGenerationRef.current;
    modelDiscovery.clearDiscovery();
    setIsDetecting(true);
    clearDetectMessageTimeout();
    setDetectMessage(
      providerType === "openai-compatible"
        ? "Checking OpenAI-compatible endpoint..."
        : "Searching for Ollama...",
    );

    try {
      if (providerType === "openai-compatible" || aiEndpoint.trim()) {
        await handleDetectTypedProvider(generation);
        return;
      }

      const result = await aiApi.detectOllama();
      if (detectionGenerationRef.current !== generation) return;
      if (result.found && result.endpoint) {
        const detectedModel = result.models?.[0];
        const selectedModel = aiModel || detectedModel || "";
        const detectedProfile = buildActiveProviderProfile(
          currentProviderFields(),
          { endpoint: result.endpoint, model: selectedModel },
        );
        const nextSettings = await updateSystemSettings(
          buildProviderSettingsUpdate(providerProfiles, detectedProfile),
        );
        if (detectionGenerationRef.current !== generation) return;
        const source = applySettingsResponse(nextSettings);
        await modelDiscovery.loadModelsFromSource(source);
        if (detectionGenerationRef.current !== generation) return;

        if (result.models?.length) {
          setDetectMessage(
            `Found Ollama with ${result.models.length} model(s) - saved!`,
          );
        } else {
          setDetectMessage(`Found Ollama at ${result.endpoint} - saved!`);
        }
      } else {
        setDetectMessage(result.message || "Ollama not found. Is it running?");
      }
    } catch (error) {
      if (detectionGenerationRef.current !== generation) return;
      log.error("AI provider detection failed", { error });
      setDetectMessage(
        getApiDisplayMessage(
          error,
          providerType === "openai-compatible"
            ? "Connection failed. Check the endpoint URL and LLM egress proxy allowlist."
            : "Detection failed. Check LLM egress proxy logs.",
        ),
      );
    } finally {
      if (detectionGenerationRef.current !== generation) return;
      setIsDetecting(false);
      detectMessageTimeoutRef.current = setTimeout(() => {
        setDetectMessage("");
        detectMessageTimeoutRef.current = null;
      }, 5000);
    }
  };

  const handleSelectModel = (modelName: string) => {
    setAiModel(modelName);
    modelDiscovery.setShowModelDropdown(false);
  };

  const handleSelectProviderProfile = (profileId: string) => {
    const activeProfile = providerProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (activeProfile) {
      invalidateDetection();
      invalidateSave();
      applyProviderProfile(activeProfile);
    }
  };

  const handleAddProviderProfile = () => {
    invalidateDetection();
    invalidateSave();
    const profile = createProviderProfile(
      `provider-${Date.now().toString(36)}`,
    );
    setProviderProfiles((profiles) => [...profiles, profile]);
    applyProviderProfile(profile);
  };

  const handleRemoveActiveProviderProfile = () => {
    if (providerProfiles.length <= 1) return;
    invalidateDetection();
    invalidateSave();
    const nextProfiles = providerProfiles.filter(
      (profile) => profile.id !== activeProviderProfileId,
    );
    const fallbackProfile = nextProfiles[0]!;
    setProviderProfiles(nextProfiles);
    applyProviderProfile(fallbackProfile);
  };

  const handleProviderCapabilityChange = (
    capability: keyof AIProviderCapabilities,
    value: boolean,
  ) => {
    invalidateDetection();
    invalidateSave();
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
    handleSaveConfig,
    handleDetectOllama,
    loadModels: modelDiscovery.loadModels,
    handleSelectProviderProfile,
    handleAddProviderProfile,
    handleRemoveActiveProviderProfile,
    handleProviderCapabilityChange,
    availableModels: modelDiscovery.availableModels,
    isLoadingModels: modelDiscovery.isLoadingModels,
    configuredModelRefreshAvailable:
      modelDiscovery.configuredModelRefreshAvailable,
    configuredModelRefreshUnavailableReason:
      modelDiscovery.configuredModelRefreshUnavailableReason,
    showModelDropdown: modelDiscovery.showModelDropdown,
    setShowModelDropdown: modelDiscovery.setShowModelDropdown,
    handleSelectModel,
  };
}

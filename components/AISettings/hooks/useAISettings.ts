/**
 * Hook for AI settings state and persistence
 *
 * Manages loading/saving of AI configuration (enabled, endpoint, model)
 * and auto-detection of Ollama instances.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import * as adminApi from "../../../src/api/admin";
import * as aiApi from "../../../src/api/ai";
import { ApiError } from "../../../src/api/client";
import { createLogger } from "../../../utils/logger";
import type {
  AIProviderCapabilities,
  AIProviderType,
} from "../../../src/api/admin";
import {
  createProviderProfile,
  normalizeProviderProfiles,
  replaceProviderProfile,
  stripProviderCredentialState,
  type EditableProviderProfile,
} from "../providerProfileModel";

const log = createLogger("AISettings:useAISettings");

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

  // Handlers
  handleSaveConfig: () => Promise<void>;
  handleDetectOllama: () => Promise<void>;
  loadModels: () => Promise<void>;
  handleSelectProviderProfile: (profileId: string) => void;
  handleAddProviderProfile: () => void;
  handleRemoveActiveProviderProfile: () => void;
  handleProviderCapabilityChange: (
    capability: keyof AIProviderCapabilities,
    value: boolean,
  ) => void;

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

  const [providerProfiles, setProviderProfiles] = useState<
    EditableProviderProfile[]
  >([]);
  const [activeProviderProfileId, setActiveProviderProfileId] =
    useState("default-ollama");
  const [providerName, setProviderName] = useState("Default Ollama");
  const [providerType, setProviderType] = useState<AIProviderType>("ollama");
  const [providerCapabilities, setProviderCapabilities] =
    useState<AIProviderCapabilities>({
      chat: true,
      toolCalls: false,
      strictJson: true,
    });
  const [credentialApiKey, setCredentialApiKey] = useState("");
  const [clearCredential, setClearCredential] = useState(false);

  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [aiModel, setAiModel] = useState("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState("");

  // Models state
  const [availableModels, setAvailableModels] = useState<aiApi.OllamaModel[]>(
    [],
  );
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const detectMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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

  const applyProviderProfile = useCallback(
    (profile: EditableProviderProfile) => {
      setActiveProviderProfileId(profile.id);
      setProviderName(profile.name);
      setProviderType(profile.providerType);
      setProviderCapabilities(profile.capabilities);
      setAiEndpoint(profile.endpoint);
      setAiModel(profile.model);
      setCredentialApiKey("");
      setClearCredential(false);
    },
    [],
  );

  const applySettingsResponse = useCallback(
    (settings: adminApi.SystemSettings) => {
      const providerState = normalizeProviderProfiles(settings);
      setProviderProfiles(providerState.profiles);
      applyProviderProfile(providerState.activeProfile);
      setAiEnabled(settings.aiEnabled || false);
    },
    [applyProviderProfile],
  );

  const loadModels = useCallback(async () => {
    if (!aiEndpoint) return;

    setIsLoadingModels(true);
    try {
      const result = await aiApi.listModels();
      setAvailableModels(result.models || []);
    } catch (error) {
      log.error("Failed to load models", { error });
    } finally {
      setIsLoadingModels(false);
    }
  }, [aiEndpoint]);

  const buildActiveProviderProfile = (overrides?: {
    endpoint?: string;
    model?: string;
  }): EditableProviderProfile => ({
    id: activeProviderProfileId,
    name: providerName.trim() || "Unnamed provider",
    providerType,
    endpoint: overrides?.endpoint ?? aiEndpoint.trim(),
    model: overrides?.model ?? aiModel.trim(),
    capabilities: providerCapabilities,
  });

  const buildProviderSettingsUpdate = (
    activeProfile: EditableProviderProfile,
    credentialUpdate?: adminApi.AIProviderCredentialUpdate[],
  ): adminApi.SystemSettingsUpdate => {
    const nextProfiles = replaceProviderProfile(
      providerProfiles,
      activeProfile,
    ).map(stripProviderCredentialState);

    return {
      aiEndpoint: activeProfile.endpoint,
      aiModel: activeProfile.model,
      aiProviderProfiles: nextProfiles,
      aiActiveProviderProfileId: activeProfile.id,
      ...(credentialUpdate
        ? { aiProviderCredentialUpdates: credentialUpdate }
        : {}),
    };
  };

  const buildCredentialUpdate = (
    profileId: string,
  ): adminApi.AIProviderCredentialUpdate[] | undefined =>
    credentialApiKey || clearCredential
      ? [
          {
            profileId,
            type: "api-key" as const,
            apiKey: credentialApiKey,
            clear: clearCredential,
          },
        ]
      : undefined;

  const providerLabel = (type: AIProviderType) =>
    type === "openai-compatible" ? "OpenAI-compatible" : "Ollama";

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Check if the aiAssistant feature flag is enabled
        const flags = await adminApi.getFeatureFlags();
        const aiFlag = flags.find((f) => f.key === "aiAssistant");
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
        const settings = await adminApi.getSystemSettings();
        applySettingsResponse(settings);
      } catch (error) {
        log.error("Failed to load AI settings", { error });
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

  useEffect(
    () => () => {
      clearSaveSuccessTimeout();
      clearDetectMessageTimeout();
    },
    [clearDetectMessageTimeout, clearSaveSuccessTimeout],
  );

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const activeProfile = buildActiveProviderProfile();
      const nextSettings = await adminApi.updateSystemSettings(
        buildProviderSettingsUpdate(
          activeProfile,
          buildCredentialUpdate(activeProfile.id),
        ),
      );
      applySettingsResponse(nextSettings);
      setSaveSuccess(true);
      clearSaveSuccessTimeout();
      saveSuccessTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimeoutRef.current = null;
      }, 3000);
      // Reload models after saving
      loadModels();
    } catch (error) {
      log.error("Failed to save AI configuration", { error });
      setSaveError("Failed to save AI configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetectTypedProvider = async () => {
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
    if (!result.found) {
      setAvailableModels([]);
      setDetectMessage(result.message || "Provider endpoint not reachable.");
      return;
    }

    const models = result.models || [];
    setAvailableModels(models);

    const detectedProviderType = result.providerType ?? providerType;
    if (detectedProviderType !== providerType) {
      setProviderType(detectedProviderType);
    }

    const detectedEndpoint = result.endpoint ?? endpoint;
    const profile = buildActiveProviderProfile({ endpoint: detectedEndpoint });
    const profileToSave = {
      ...profile,
      providerType: detectedProviderType,
    };
    const credentialUpdate =
      credentialApiKey || clearCredential
        ? buildCredentialUpdate(profileToSave.id)
        : undefined;

    if (models.length === 0) {
      await adminApi.updateSystemSettings(
        buildProviderSettingsUpdate(profileToSave, credentialUpdate),
      );
      setDetectMessage(
        "Connected to provider endpoint, but no models were reported. Enter the model name manually, then save.",
      );
      return;
    }

    const firstModel = models[0].name;
    const selectedModel = aiModel.trim() || firstModel;
    if (!aiModel.trim()) {
      setAiModel(firstModel);
    }

    await adminApi.updateSystemSettings(
      buildProviderSettingsUpdate(
        { ...profileToSave, model: selectedModel },
        credentialUpdate,
      ),
    );

    setDetectMessage(
      `Connected to ${providerLabel(detectedProviderType)} endpoint with ${models.length} model(s) - saved!`,
    );
  };

  const handleDetectOllama = async () => {
    setIsDetecting(true);
    clearDetectMessageTimeout();
    setDetectMessage(
      providerType === "openai-compatible"
        ? "Checking OpenAI-compatible endpoint..."
        : "Searching for Ollama...",
    );

    try {
      if (providerType === "openai-compatible" || aiEndpoint.trim()) {
        await handleDetectTypedProvider();
        return;
      }

      const result = await aiApi.detectOllama();
      if (result.found && result.endpoint) {
        setAiEndpoint(result.endpoint);

        // Auto-save the endpoint to database
        await adminApi.updateSystemSettings({ aiEndpoint: result.endpoint });

        // If models were detected, show them and auto-select first
        if (result.models && result.models.length > 0) {
          setDetectMessage(
            `Found Ollama with ${result.models.length} model(s) - saved!`,
          );
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
        setDetectMessage(result.message || "Ollama not found. Is it running?");
      }
    } catch (error) {
      log.error("AI provider detection failed", { error });
      setDetectMessage(
        providerType === "openai-compatible"
          ? "Connection failed. Check the endpoint URL and AI proxy allowlist."
          : "Detection failed. Check AI container logs.",
      );
    } finally {
      setIsDetecting(false);
      detectMessageTimeoutRef.current = setTimeout(() => {
        setDetectMessage("");
        detectMessageTimeoutRef.current = null;
      }, 5000);
    }
  };

  const handleSelectModel = (modelName: string) => {
    setAiModel(modelName);
    setShowModelDropdown(false);
  };

  const handleSelectProviderProfile = (profileId: string) => {
    const activeProfile = providerProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (activeProfile) {
      applyProviderProfile(activeProfile);
    }
  };

  const handleAddProviderProfile = () => {
    const profile = createProviderProfile(
      `provider-${Date.now().toString(36)}`,
    );
    setProviderProfiles((profiles) => [...profiles, profile]);
    applyProviderProfile(profile);
  };

  const handleRemoveActiveProviderProfile = () => {
    if (providerProfiles.length <= 1) return;
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

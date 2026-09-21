import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIProviderType } from '../../../api/admin';
import * as aiApi from '../../../api/ai';
import { ApiError } from '../../../api/client';
import { createLogger } from '../../../utils/logger';
import type { EditableProviderProfile } from '../providerProfileModel';

const log = createLogger('AISettings:modelDiscovery');
const REFRESH_UNAVAILABLE_REASON =
  'Save or Detect for this endpoint/profile before refreshing configured models.';

export interface ModelSourceSnapshot {
  profileId: string;
  endpoint: string;
  providerType: AIProviderType;
  credentialEdited: boolean;
}

export function modelSourceFromProfile(
  profile: EditableProviderProfile,
): ModelSourceSnapshot {
  return {
    profileId: profile.id,
    endpoint: normalizeEndpoint(profile.endpoint),
    providerType: profile.providerType,
    credentialEdited: false,
  };
}

export function getApiDisplayMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    const responseMessage = error.response?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }
    if (error.message.trim()) return error.message;
  }

  return fallback;
}

export function useConfiguredModelDiscovery(
  onLoadError: (message: string) => void,
) {
  const initialSource: ModelSourceSnapshot = {
    profileId: 'default-ollama',
    endpoint: '',
    providerType: 'ollama',
    credentialEdited: false,
  };
  const [visibleSource, setVisibleSource] = useState(initialSource);
  const [persistedSource, setPersistedSource] =
    useState<ModelSourceSnapshot | null>(null);
  const [availableModels, setAvailableModels] = useState<aiApi.ProviderModel[]>(
    [],
  );
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const visibleSourceRef = useRef(visibleSource);
  const persistedSourceRef = useRef<ModelSourceSnapshot | null>(null);
  const requestGenerationRef = useRef(0);

  const clearDiscovery = useCallback(() => {
    requestGenerationRef.current += 1;
    setAvailableModels([]);
    setIsLoadingModels(false);
    setShowModelDropdown(false);
  }, []);

  const updateVisibleSource = useCallback(
    (update: Partial<ModelSourceSnapshot>) => {
      const next = normalizeSource({ ...visibleSourceRef.current, ...update });
      if (!sameModelSource(next, visibleSourceRef.current)) clearDiscovery();
      visibleSourceRef.current = next;
      setVisibleSource(next);
    },
    [clearDiscovery],
  );

  const bindPersistedSource = useCallback(
    (source: ModelSourceSnapshot) => {
      const normalized = normalizeSource({ ...source, credentialEdited: false });
      clearDiscovery();
      visibleSourceRef.current = normalized;
      persistedSourceRef.current = normalized;
      setVisibleSource(normalized);
      setPersistedSource(normalized);
      return normalized;
    },
    [clearDiscovery],
  );

  const ownsRequest = useCallback(
    (generation: number, source: ModelSourceSnapshot): boolean =>
      requestGenerationRef.current === generation &&
      sameModelSource(source, visibleSourceRef.current) &&
      sameModelSource(source, persistedSourceRef.current),
    [],
  );

  const loadModelsFromSource = useCallback(
    async (requestedSource?: ModelSourceSnapshot) => {
      const source = normalizeSource(
        requestedSource ?? visibleSourceRef.current,
      );
      if (!canRefresh(source, persistedSourceRef.current)) {
        clearDiscovery();
        return;
      }

      const generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = generation;
      setIsLoadingModels(true);
      try {
        const result = await aiApi.listModels();
        if (ownsRequest(generation, source)) {
          setAvailableModels(result.models || []);
        }
      } catch (error) {
        log.error('Failed to load models', { error });
        if (ownsRequest(generation, source)) {
          setAvailableModels([]);
          onLoadError(
            getApiDisplayMessage(error, 'Failed to load provider models.'),
          );
        }
      } finally {
        if (requestGenerationRef.current === generation) {
          setIsLoadingModels(false);
        }
      }
    },
    [clearDiscovery, onLoadError, ownsRequest],
  );

  const loadModels = useCallback(
    () => loadModelsFromSource(),
    [loadModelsFromSource],
  );

  const setDetectedModels = useCallback(
    (models: aiApi.ProviderModel[]) => {
      clearDiscovery();
      setAvailableModels(models);
    },
    [clearDiscovery],
  );

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
    },
    [],
  );

  const configuredModelRefreshAvailable = canRefresh(
    visibleSource,
    persistedSource,
  );

  return {
    availableModels,
    bindPersistedSource,
    clearDiscovery,
    configuredModelRefreshAvailable,
    configuredModelRefreshUnavailableReason:
      configuredModelRefreshAvailable ? null : REFRESH_UNAVAILABLE_REASON,
    isLoadingModels,
    loadModels,
    loadModelsFromSource,
    setDetectedModels,
    setShowModelDropdown,
    showModelDropdown,
    updateVisibleSource,
  };
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim();
}

function normalizeSource(source: ModelSourceSnapshot): ModelSourceSnapshot {
  return { ...source, endpoint: normalizeEndpoint(source.endpoint) };
}

function sameModelSource(
  left: ModelSourceSnapshot,
  right: ModelSourceSnapshot | null,
): boolean {
  if (!right) return false;
  return (
    left.profileId === right.profileId &&
    left.endpoint === right.endpoint &&
    left.providerType === right.providerType &&
    left.credentialEdited === right.credentialEdited
  );
}

function canRefresh(
  visible: ModelSourceSnapshot,
  persisted: ModelSourceSnapshot | null,
): boolean {
  return sameModelSource(visible, persisted) && Boolean(visible.endpoint);
}

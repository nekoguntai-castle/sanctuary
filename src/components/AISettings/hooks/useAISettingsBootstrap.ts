import { useCallback, useEffect, useState } from 'react';
import * as adminApi from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { createLogger } from '../../../utils/logger';
import { extractErrorMessage } from '../../../utils/errorHandler';
import type { ModelSourceSnapshot } from './useConfiguredModelDiscovery';

const log = createLogger('AISettings:bootstrap');

interface AISettingsBootstrapOptions {
  applySettingsResponse: (
    settings: adminApi.SystemSettings,
  ) => ModelSourceSnapshot;
  loadModelsFromSource: (source: ModelSourceSnapshot) => Promise<void>;
  setFeatureUnavailable: (value: boolean) => void;
  setLoading: (value: boolean) => void;
}

export function useAISettingsBootstrap({
  applySettingsResponse,
  loadModelsFromSource,
  setFeatureUnavailable,
  setLoading,
}: AISettingsBootstrapOptions) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setRetryGeneration(current => current + 1);
  }, [setLoading]);
  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const flags = await adminApi.getFeatureFlags();
        const aiFlag = flags.find((flag) => flag.key === 'aiAssistant');
        if (aiFlag && !aiFlag.enabled) {
          if (active) setFeatureUnavailable(true);
          return;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          if (active) setFeatureUnavailable(true);
          return;
        }
      }

      if (!active) return;
      let settings: adminApi.SystemSettings;
      try {
        settings = await adminApi.getSystemSettings();
      } catch (error) {
        if (active) {
          log.error('Failed to load AI settings', { error });
          setLoadError(extractErrorMessage(error, 'Settings are unavailable'));
        }
        return;
      }
      if (!active) return;
      const source = applySettingsResponse(settings);
      if (settings.aiEnabled && source.endpoint) {
        await loadModelsFromSource(source);
      }
    };

    void loadSettings().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [
    applySettingsResponse,
    loadModelsFromSource,
    setFeatureUnavailable,
    setLoading,
    retryGeneration,
  ]);

  return { loadError, retryLoad };
}

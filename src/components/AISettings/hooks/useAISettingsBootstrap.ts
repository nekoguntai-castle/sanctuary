import { useEffect } from 'react';
import * as adminApi from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { createLogger } from '../../../utils/logger';
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
}: AISettingsBootstrapOptions): void {
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

      try {
        const settings = await adminApi.getSystemSettings();
        if (!active) return;
        const source = applySettingsResponse(settings);
        if (settings.aiEnabled && source.endpoint) {
          await loadModelsFromSource(source);
        }
      } catch (error) {
        log.error('Failed to load AI settings', { error });
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
  ]);
}

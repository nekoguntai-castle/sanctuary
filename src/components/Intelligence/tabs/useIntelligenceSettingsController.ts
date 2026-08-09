import { useCallback, useEffect, useRef, useState } from 'react';
import * as intelligenceApi from '../../../api/intelligence';
import type { WalletIntelligenceSettings } from '../../../api/intelligence';
import { createRequestOwnership } from '../../../hooks/requestOwnership';
import { createLogger } from '../../../utils/logger';

const log = createLogger('IntelligenceSettings');

export function useIntelligenceSettingsController(walletId: string) {
  const [settings, setSettings] = useState<WalletIntelligenceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const ownership = useRef(createRequestOwnership(walletId));
  const settingsRef = useRef<WalletIntelligenceSettings | null>(null);
  const committedRef = useRef<WalletIntelligenceSettings | null>(null);
  const queueRef = useRef(Promise.resolve());
  const mutationGeneration = useRef(0);
  ownership.current.setRoute(walletId);

  const commitLocal = useCallback((next: WalletIntelligenceSettings | null) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    const token = ownership.current.beginFetch(walletId);
    commitLocal(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await intelligenceApi.getIntelligenceSettings(walletId);
        if (!ownership.current.isFetchOwner(token)) return;
        committedRef.current = result.settings;
        commitLocal(result.settings);
      } catch (error) {
        if (ownership.current.isFetchOwner(token)) log.error('Failed to load intelligence settings', { error });
      } finally {
        if (ownership.current.isFetchOwner(token)) setLoading(false);
      }
    })();
  }, [commitLocal, walletId]);

  const updateSetting = useCallback((update: Partial<WalletIntelligenceSettings>) => {
    // The settings controls only render after the non-null controller state guard.
    const current = settingsRef.current!;
    const optimistic = { ...current, ...update };
    const token = ownership.current.captureRoute(walletId);
    const generation = ++mutationGeneration.current;
    commitLocal(optimistic);
    setSaving(true);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const result = await intelligenceApi.updateIntelligenceSettings(walletId, update);
        const ownsRoute = ownership.current.isRouteOwner(token);
        if (ownsRoute) committedRef.current = result.settings;
        if (ownsRoute && mutationGeneration.current === generation) {
          commitLocal(result.settings);
        }
      } catch (error) {
        if (ownership.current.isRouteOwner(token) && mutationGeneration.current === generation) {
          log.error('Failed to update settings', { error });
          commitLocal(committedRef.current);
        }
      } finally {
        if (ownership.current.isRouteOwner(token) && mutationGeneration.current === generation) {
          setSaving(false);
        }
      }
    });
  }, [commitLocal, walletId]);

  return { settings, loading, saving, updateSetting };
}

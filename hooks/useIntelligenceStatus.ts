/**
 * Intelligence Status Hook
 *
 * Checks if Treasury Intelligence is available:
 * - Both aiAssistant and treasuryIntelligence feature flags enabled
 * - AI container reachable
 * - Ollama-compatible endpoint configured
 *
 * Returns { available: false } silently if any condition fails.
 * Caches result for 5 minutes.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as intelligenceApi from '../src/api/intelligence';

interface IntelligenceStatusResult {
  available: boolean;
  loading: boolean;
  endpointType?: 'container' | 'host' | 'remote';
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedResult: IntelligenceStatusResult | null = null;
let cachedAt = 0;

export function useIntelligenceStatus(): IntelligenceStatusResult {
  const [status, setStatus] = useState<IntelligenceStatusResult>(
    cachedResult ?? { available: false, loading: true }
  );
  const mountedRef = useRef(true);

  const checkStatus = useCallback(async () => {
    // Use cache if fresh
    if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
      setStatus(cachedResult);
      return;
    }

    try {
      const result = await intelligenceApi.getIntelligenceStatus();
      const newStatus: IntelligenceStatusResult = {
        available: result.available,
        loading: false,
        endpointType: result.endpointType,
      };

      cachedResult = newStatus;
      cachedAt = Date.now();

      if (mountedRef.current) {
        setStatus(newStatus);
      }
    } catch {
      // Silently fail — feature flags not enabled or 403
      const newStatus: IntelligenceStatusResult = { available: false, loading: false };
      cachedResult = newStatus;
      cachedAt = Date.now();

      if (mountedRef.current) {
        setStatus(newStatus);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkStatus();

    return () => {
      mountedRef.current = false;
    };
  }, [checkStatus]);

  return status;
}

/**
 * Invalidate the cached status (call after changing settings)
 */
export function invalidateIntelligenceStatus(): void {
  cachedResult = null;
  cachedAt = 0;
}

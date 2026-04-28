/**
 * Hook to check if AI features are enabled
 */

import { useState, useEffect } from 'react';
import * as aiApi from '../src/api/ai';

interface AIStatusState {
  enabled: boolean;
  loading: boolean;
  available: boolean;
}

// Cache the result to avoid repeated API calls
let cachedStatus: AIStatusState | null = null;
let fetchPromise: Promise<AIStatusState> | null = null;

async function fetchAIStatus(): Promise<AIStatusState> {
  try {
    const status = await aiApi.getAIStatus();
    return {
      enabled: status.enabled ?? !!status.available,
      loading: false,
      available: !!status.available && !!status.containerAvailable,
    };
  } catch {
    return {
      enabled: false,
      loading: false,
      available: false,
    };
  }
}

export function useAIStatus(): AIStatusState {
  const [status, setStatus] = useState<AIStatusState>(
    cachedStatus || { enabled: false, loading: true, available: false }
  );

  useEffect(() => {
    if (cachedStatus) {
      setStatus(cachedStatus);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetchAIStatus();
    }

    fetchPromise.then((result) => {
      cachedStatus = result;
      setStatus(result);
    });
  }, []);

  return status;
}

// Function to invalidate the cache (call when settings change)
export function invalidateAIStatusCache(): void {
  cachedStatus = null;
  fetchPromise = null;
}

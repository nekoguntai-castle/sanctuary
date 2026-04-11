import { useMemo } from 'react';
import type { AppCapabilityStatus } from '../src/app/capabilities';
import { useIntelligenceStatus } from './useIntelligenceStatus';

export function useAppCapabilities(): AppCapabilityStatus {
  const { available: intelligenceAvailable } = useIntelligenceStatus();

  return useMemo(() => ({
    intelligence: intelligenceAvailable,
  }), [intelligenceAvailable]);
}

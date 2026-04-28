import { useMemo } from 'react';
import type { AppCapabilityStatus } from '../src/app/capabilities';
import { useConsoleAvailability } from './useConsoleAvailability';
import { useIntelligenceStatus } from './useIntelligenceStatus';

export function useAppCapabilities(): AppCapabilityStatus {
  const { available: consoleAvailable } = useConsoleAvailability();
  const { available: intelligenceAvailable } = useIntelligenceStatus();

  return useMemo(() => ({
    console: consoleAvailable,
    intelligence: intelligenceAvailable,
  }), [consoleAvailable, intelligenceAvailable]);
}

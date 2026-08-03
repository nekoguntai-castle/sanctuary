import { useMemo } from 'react';
import type { AppCapabilityStates, AppCapabilityStatus } from '../app/capabilities';
import { useConsoleAvailability } from './useConsoleAvailability';
import { useIntelligenceStatus } from './useIntelligenceStatus';

export function useAppCapabilityStates(): AppCapabilityStates {
  const consoleState = useConsoleAvailability();
  const intelligenceState = useIntelligenceStatus();

  return useMemo(() => ({
    console: {
      available: consoleState.available,
      loading: consoleState.loading,
    },
    intelligence: {
      available: intelligenceState.available,
      loading: intelligenceState.loading,
    },
  }), [
    consoleState.available,
    consoleState.loading,
    intelligenceState.available,
    intelligenceState.loading,
  ]);
}

export function useAppCapabilities(): AppCapabilityStatus {
  const capabilityStates = useAppCapabilityStates();

  return useMemo(() => ({
    console: capabilityStates.console?.available === true,
    intelligence: capabilityStates.intelligence?.available === true,
  }), [capabilityStates]);
}

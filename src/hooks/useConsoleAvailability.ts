import { useAIStatus } from './useAIStatus';

interface ConsoleAvailabilityState {
  available: boolean;
  loading: boolean;
  reason?: 'ai-unavailable';
}

export function useConsoleAvailability(): ConsoleAvailabilityState {
  const aiStatus = useAIStatus();

  if (aiStatus.loading) {
    return { available: false, loading: true };
  }

  if (!aiStatus.enabled) {
    return { available: false, loading: false, reason: 'ai-unavailable' };
  }

  return {
    available: true,
    loading: false,
  };
}

export type AppCapability = 'console' | 'intelligence';

export type AppCapabilityStatus = Partial<Record<AppCapability, boolean>>;

export interface AppCapabilityState {
  available: boolean;
  loading: boolean;
}

export type AppCapabilityStates = Partial<Record<AppCapability, AppCapabilityState>>;

export type AppCapabilityGateState = 'available' | 'loading' | 'unavailable';

export function hasRequiredCapabilities(
  requiredCapabilities: readonly AppCapability[] | undefined,
  capabilities: AppCapabilityStatus = {}
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }

  return requiredCapabilities.every((capability) => capabilities[capability] === true);
}

export function getRequiredCapabilityGateState(
  requiredCapabilities: readonly AppCapability[] | undefined,
  capabilities: AppCapabilityStates = {}
): AppCapabilityGateState {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return 'available';
  }

  let isLoading = false;

  for (const capability of requiredCapabilities) {
    const state = capabilities[capability];

    if (state?.available) {
      continue;
    }

    if (state?.loading) {
      isLoading = true;
      continue;
    }

    return 'unavailable';
  }

  return isLoading ? 'loading' : 'available';
}

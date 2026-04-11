export type AppCapability = 'intelligence';

export type AppCapabilityStatus = Partial<Record<AppCapability, boolean>>;

export function hasRequiredCapabilities(
  requiredCapabilities: readonly AppCapability[] | undefined,
  capabilities: AppCapabilityStatus = {}
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }

  return requiredCapabilities.every((capability) => capabilities[capability] === true);
}

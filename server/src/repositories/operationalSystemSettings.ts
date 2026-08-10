export const OPERATIONAL_SYSTEM_SETTING_PREFIX = 'operational.';
export const FEATURE_RUNTIME_GENERATION_KEY =
  `${OPERATIONAL_SYSTEM_SETTING_PREFIX}feature-runtime.generation`;

export function isOperationalSystemSettingKey(key: string): boolean {
  return key.startsWith(OPERATIONAL_SYSTEM_SETTING_PREFIX);
}

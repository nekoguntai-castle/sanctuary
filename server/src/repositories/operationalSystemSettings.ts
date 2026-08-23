export const OPERATIONAL_SYSTEM_SETTING_PREFIX = 'operational.';
export const FEATURE_RUNTIME_GENERATION_KEY =
  `${OPERATIONAL_SYSTEM_SETTING_PREFIX}feature-runtime.generation`;
export const STALE_WALLET_SCHEDULE_FORBIDDEN_KEY =
  `${OPERATIONAL_SYSTEM_SETTING_PREFIX}wallet-sync.check-stale-wallets-forbidden.v1`;
export const WALLET_SYNC_ACTIVATION_KEY =
  `${OPERATIONAL_SYSTEM_SETTING_PREFIX}wallet-sync.activation.v1`;
export const WALLET_SYNC_ACTIVATION_STABILIZATION_KEY =
  `${OPERATIONAL_SYSTEM_SETTING_PREFIX}wallet-sync.activation-stabilization.v1`;

export function isOperationalSystemSettingKey(key: string): boolean {
  return key.startsWith(OPERATIONAL_SYSTEM_SETTING_PREFIX);
}

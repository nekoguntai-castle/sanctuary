export const DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES = [
  'SYNC_INTERVAL_MS',
  'SYNC_STALE_THRESHOLD_MS',
  'SYNC_STALE_BATCH_SIZE',
  'SYNC_STAGGER_DELAY_MS',
  'SYNC_STARTUP_CATCH_UP_BATCH_SIZE',
  'SYNC_STARTUP_CATCH_UP_DELAY_MS',
  'SYNC_STARTUP_CATCH_UP_STAGGER_DELAY_MS',
] as const;

type Warn = (message: string, context: { variable: string }) => void;

/** Emit names only; configuration values may contain deployment-sensitive data. */
export function warnDeprecatedStaleSyncEnvironment(warn: Warn): void {
  for (const variable of DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES) {
    if (process.env[variable] === undefined || process.env[variable] === '') continue;
    warn(
      'Deprecated stale-wallet scheduler configuration is ignored after retirement',
      { variable },
    );
  }
}

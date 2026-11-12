import { z } from 'zod';
import { parseIntegerEnv } from './envSections';

/**
 * The single reader for the Electrum pool environment variables. They used to
 * be parsed in the pool registry with a bare parseInt, so a typo became NaN and
 * was handed to the pool. An invalid value now throws with the name of the
 * setting.
 *
 * Bounds follow what the pool tolerated before: a connection count of 0 is
 * allowed (the pool sizes itself from the server list), but an interval or
 * timeout of 0 is not, because it turns the pool's timers into a tight loop.
 */

const ElectrumPoolEnvSchema = z.object({
  enabled: z.boolean(),
  minConnections: z.number().int().min(0),
  maxConnections: z.number().int().min(0),
  idleTimeoutMs: z.number().int().min(1),
  healthCheckIntervalMs: z.number().int().min(1),
  acquisitionTimeoutMs: z.number().int().min(1),
  keepaliveIntervalMs: z.number().int().min(1),
});

export type ElectrumPoolEnvConfig = z.infer<typeof ElectrumPoolEnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid ${label} configuration: ${details}`);
  }
  return parsed.data;
}

/** Pool settings from the environment. Database settings override these. */
export function loadElectrumPoolEnvConfig(): ElectrumPoolEnvConfig {
  return parseOrThrow(ElectrumPoolEnvSchema, {
    // Defaults to on; set to 'false' for single-connection mode.
    enabled: process.env.ELECTRUM_POOL_ENABLED !== 'false',
    minConnections: parseIntegerEnv('ELECTRUM_POOL_MIN_CONNECTIONS', 2),
    maxConnections: parseIntegerEnv('ELECTRUM_POOL_MAX_CONNECTIONS', 10),
    idleTimeoutMs: parseIntegerEnv('ELECTRUM_POOL_IDLE_TIMEOUT_MS', 300000),
    healthCheckIntervalMs: parseIntegerEnv('ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS', 30000),
    acquisitionTimeoutMs: parseIntegerEnv('ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS', 5000),
    keepaliveIntervalMs: parseIntegerEnv('ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS', 15000),
  }, 'Electrum pool');
}

import { describe } from 'vitest';

const REQUIRE_REDIS_ENV = 'SANCTUARY_REQUIRE_REDIS_INTEGRATION';

export type RedisIntegrationMode = 'run' | 'skip';

export function redisIntegrationMode(
  env: NodeJS.ProcessEnv = process.env,
): RedisIntegrationMode {
  const requirement = env[REQUIRE_REDIS_ENV];
  if (
    requirement !== undefined &&
    requirement !== 'true' &&
    requirement !== 'false'
  ) {
    throw new Error(`${REQUIRE_REDIS_ENV} must be true or false`);
  }

  if (env.REDIS_URL?.trim()) {
    return 'run';
  }
  if (requirement === 'true') {
    throw new Error('Redis integration is required but REDIS_URL is not set');
  }
  return 'skip';
}

export function describeWithRedis(name: string, suite: () => void): void {
  const declareSuite =
    redisIntegrationMode() === 'run' ? describe : describe.skip;
  declareSuite(name, suite);
}

import { describe, expect, it } from 'vitest';
import { redisIntegrationMode } from '../../integration/setup/redis';

describe('Redis integration test support', () => {
  it.each(['true', 'false'])(
    'runs when REDIS_URL is set and enforcement is %s',
    (requirement) => {
      expect(
        redisIntegrationMode({
          REDIS_URL: ' redis://localhost:6379 ',
          SANCTUARY_REQUIRE_REDIS_INTEGRATION: requirement,
        }),
      ).toBe('run');
    },
  );

  it.each([undefined, 'false'])(
    'skips when Redis is unavailable and enforcement is %s',
    (requirement) => {
      expect(
        redisIntegrationMode({
          SANCTUARY_REQUIRE_REDIS_INTEGRATION: requirement,
        }),
      ).toBe('skip');
    },
  );

  it('fails when Redis is required without a URL', () => {
    expect(() =>
      redisIntegrationMode({
        REDIS_URL: '   ',
        SANCTUARY_REQUIRE_REDIS_INTEGRATION: 'true',
      }),
    ).toThrow('Redis integration is required but REDIS_URL is not set');
  });

  it.each(['TRUE', '1', '', ' true '])(
    'fails closed for invalid enforcement value %j',
    (requirement) => {
      expect(() =>
        redisIntegrationMode({
          REDIS_URL: 'redis://localhost:6379',
          SANCTUARY_REQUIRE_REDIS_INTEGRATION: requirement,
        }),
      ).toThrow('SANCTUARY_REQUIRE_REDIS_INTEGRATION must be true or false');
    },
  );
});

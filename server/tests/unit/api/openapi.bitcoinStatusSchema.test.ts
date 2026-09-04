/**
 * BitcoinStatus / NodeOperationalStatus OpenAPI contract tests.
 *
 * These assert the public API contract fixed by
 * docs/plans/dashboard-network-status-card-redesign.md (section "Status
 * contract" / A5): the OpenAPI document still builds, the enums mirror the
 * shared contract vocabularies exactly, and sample payloads for the three
 * `route.transport` variants validate (or are rejected) per the
 * discriminated-union rules — pool requires `serverId` and forbids
 * `fallbackReason`; singleton has a null `serverId` and no reason; a
 * singleton fallback requires both a null `serverId` and a reason code.
 */
// ajv is resolved from the root workspace lockfile (hoisted transitive dependency);
// it is intentionally not added to server/package.json because lockfile changes
// invalidate the pinned hardware-compatibility statement (tests/ci/hardwareCompatibilityReport).
import Ajv from 'ajv';
import { describe, expect, it, beforeAll } from 'vitest';
import type { ValidateFunction } from 'ajv';

import { NODE_POOL_LOAD_BALANCING_VALUES } from '@sanctuary/shared/constants/nodeConfig';
import {
  SERVER_AVAILABILITY_VALUES,
  POOL_FALLBACK_REASON_VALUES,
} from '../../../src/api/openapi/schemas/bitcoin';
import { openApiSpec } from '../../../src/api/openapi/spec';

describe('OpenAPI BitcoinStatus / NodeOperationalStatus contract', () => {
  const schemas = openApiSpec.components.schemas as Record<string, unknown>;

  it('builds the OpenAPI document with the new schemas registered', () => {
    for (const name of [
      'BitcoinStatus',
      'BitcoinStatusPool',
      'BitcoinStatusPoolStats',
      'BitcoinStatusServerStats',
      'ServerAvailability',
      'PoolFallbackReason',
      'NodeRouteObservation',
      'OperationalServer',
      'PoolOperationalStatus',
      'NodeOperationalStatus',
    ]) {
      expect(schemas[name], `expected schema ${name} to be registered`).toBeDefined();
    }
  });

  it('mirrors the fixed ServerAvailability vocabulary', () => {
    expect(SERVER_AVAILABILITY_VALUES).toEqual(['online', 'offline', 'cooldown', 'unchecked', 'stale']);
    expect((schemas.ServerAvailability as { enum: string[] }).enum).toEqual([...SERVER_AVAILABILITY_VALUES]);
  });

  it('mirrors the fixed PoolFallbackReason vocabulary', () => {
    expect(POOL_FALLBACK_REASON_VALUES).toEqual([
      'pool_uninitialized',
      'pool_empty',
      'pool_probe_failed',
      'pool_circuit_open',
    ]);
    expect((schemas.PoolFallbackReason as { enum: string[] }).enum).toEqual([...POOL_FALLBACK_REASON_VALUES]);
  });

  it('sources PoolOperationalStatus.strategy from NODE_POOL_LOAD_BALANCING_VALUES (no fourth value)', () => {
    const strategySchema = (
      schemas.PoolOperationalStatus as { properties: { strategy: { enum: string[] } } }
    ).properties.strategy;
    expect(strategySchema.enum).toEqual([...NODE_POOL_LOAD_BALANCING_VALUES]);
    expect(strategySchema.enum).toHaveLength(3);
  });

  describe('sample payload validation', () => {
    let ajv: Ajv;
    let validateStatus: ValidateFunction;
    let validateRoute: ValidateFunction;

    beforeAll(() => {
      ajv = new Ajv({ strict: false });
      ajv.addSchema(openApiSpec, 'root');
      const status = ajv.getSchema('root#/components/schemas/BitcoinStatus');
      const route = ajv.getSchema('root#/components/schemas/NodeRouteObservation');
      if (!status || !route) {
        throw new Error('failed to compile BitcoinStatus / NodeRouteObservation schemas');
      }
      validateStatus = status;
      validateRoute = route;
    });

    const poolOperationalStatus = {
      strategy: 'failover_only',
      online: 1,
      offline: 1,
      cooldown: 0,
      unchecked: 0,
      stale: 0,
      primaryServerId: 'server-a',
      preferredServerId: 'server-a',
      nextFailoverServerId: 'server-b',
      servers: [
        {
          serverId: 'server-a',
          label: 'Primary',
          host: 'a.example.com',
          port: 50002,
          priority: 0,
          availability: 'online',
          checkedAt: '2026-09-03T00:00:00.000Z',
        },
        {
          serverId: 'server-b',
          label: 'Backup',
          host: 'b.example.com',
          port: 50002,
          priority: 1,
          availability: 'offline',
          checkedAt: '2026-09-03T00:00:00.000Z',
        },
      ],
    };

    it('validates the pool-route connected envelope', () => {
      const payload = {
        connected: true,
        server: 'ElectrumX',
        protocol: '1.4',
        blockHeight: 850000,
        network: 'mainnet',
        explorerUrl: 'https://mempool.space',
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
        pool: {
          enabled: true,
          minConnections: 1,
          maxConnections: 5,
          stats: null,
        },
        operational: {
          configuredMode: 'pool',
          attemptedAt: '2026-09-03T00:00:00.000Z',
          route: { transport: 'pool', observedAt: '2026-09-03T00:00:00.000Z', serverId: 'server-a' },
          pool: poolOperationalStatus,
        },
      };
      const ok = validateStatus(payload);
      expect(ok, JSON.stringify(validateStatus.errors)).toBe(true);
    });

    it('validates the singleton disconnected envelope (route: null observation surfaced separately)', () => {
      const payload = {
        connected: false,
        error: 'Connection refused',
        network: 'mainnet',
        pool: null,
        operational: {
          configuredMode: 'singleton',
          attemptedAt: '2026-09-03T00:00:00.000Z',
          route: null,
          pool: null,
        },
      };
      const ok = validateStatus(payload);
      expect(ok, JSON.stringify(validateStatus.errors)).toBe(true);
    });

    it('validates the singleton_fallback route observation', () => {
      const payload = {
        connected: true,
        network: 'mainnet',
        pool: null,
        operational: {
          configuredMode: 'pool',
          attemptedAt: '2026-09-03T00:00:00.000Z',
          route: {
            transport: 'singleton_fallback',
            observedAt: '2026-09-03T00:00:00.000Z',
            serverId: null,
            fallbackReason: 'pool_empty',
          },
          pool: poolOperationalStatus,
        },
      };
      const ok = validateStatus(payload);
      expect(ok, JSON.stringify(validateStatus.errors)).toBe(true);
    });

    it('validates the minimal legacy envelope (operational omitted)', () => {
      const payload = { connected: false, error: 'Configuration read failed' };
      const ok = validateStatus(payload);
      expect(ok, JSON.stringify(validateStatus.errors)).toBe(true);
    });

    it('rejects a pool-transport route observation carrying fallbackReason', () => {
      const ok = validateRoute({
        transport: 'pool',
        observedAt: '2026-09-03T00:00:00.000Z',
        serverId: 'server-a',
        fallbackReason: 'pool_empty',
      });
      expect(ok).toBe(false);
    });

    it('rejects a singleton_fallback route observation missing fallbackReason', () => {
      const ok = validateRoute({
        transport: 'singleton_fallback',
        observedAt: '2026-09-03T00:00:00.000Z',
        serverId: null,
      });
      expect(ok).toBe(false);
    });

    it('rejects a singleton route observation with a string serverId', () => {
      const ok = validateRoute({
        transport: 'singleton',
        observedAt: '2026-09-03T00:00:00.000Z',
        serverId: 'server-a',
      });
      expect(ok).toBe(false);
    });

    it('rejects a pool-transport route observation missing serverId', () => {
      const ok = validateRoute({
        transport: 'pool',
        observedAt: '2026-09-03T00:00:00.000Z',
      });
      expect(ok).toBe(false);
    });
  });
});

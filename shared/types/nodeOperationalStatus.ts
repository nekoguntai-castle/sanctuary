/**
 * Node Operational Status — shared DTO contract types.
 *
 * This module owns the `NodeOperationalStatus` DTO contract shared across
 * the backend projector (`server/src/services/bitcoin/nodeOperationalStatus.ts`),
 * the OpenAPI schema (`server/src/api/openapi/schemas/bitcoin.ts`), and the
 * frontend (`src/api/bitcoin.ts`). All three import from here — there is a
 * single source of truth for these names and shapes.
 */

import type { NodePoolLoadBalancing } from '../constants/nodeConfig';

export type ServerAvailability = 'online' | 'offline' | 'cooldown' | 'unchecked' | 'stale';
export const SERVER_AVAILABILITY_VALUES = ['online', 'offline', 'cooldown', 'unchecked', 'stale'] as const;

export type PoolFallbackReason =
  | 'pool_uninitialized'
  | 'pool_empty'
  | 'pool_probe_failed'
  | 'pool_circuit_open';
export const POOL_FALLBACK_REASON_VALUES = [
  'pool_uninitialized',
  'pool_empty',
  'pool_probe_failed',
  'pool_circuit_open',
] as const;

export type NodeRouteObservation =
  | { transport: 'pool'; observedAt: string; serverId: string }
  | { transport: 'singleton'; observedAt: string; serverId: null }
  | { transport: 'singleton_fallback'; observedAt: string; serverId: null; fallbackReason: PoolFallbackReason };

export interface OperationalServer {
  serverId: string;
  label: string;
  host: string;
  port: number;
  priority: number;
  availability: ServerAvailability;
  checkedAt: string | null;
}

export interface PoolOperationalStatus {
  strategy: NodePoolLoadBalancing;
  online: number;
  offline: number;
  cooldown: number;
  unchecked: number;
  stale: number;
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextFailoverServerId: string | null;
  servers: OperationalServer[];
}

export interface NodeOperationalStatus {
  configuredMode: 'singleton' | 'pool';
  attemptedAt: string;
  route: NodeRouteObservation | null;
  pool: PoolOperationalStatus | null;
}

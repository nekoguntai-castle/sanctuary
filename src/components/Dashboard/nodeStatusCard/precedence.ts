/**
 * Top-level Node Status precedence chain.
 *
 * Order (fixed by the plan and the PR B interface contract):
 *   mismatched/initial -> last-known wrapper -> successful singleton fallback
 *   -> configuration gap -> route failure -> normal singleton/balanced/failover.
 */

import type { BitcoinStatus, NodeOperationalStatus } from '../../../api/bitcoin';
import { formatNetworkTitle } from '../../../app/networks';
import { ADMIN_GUIDANCE, buildBadges, formatBlockHeight, formatHost, safeIsoString, strategyLabel } from './copy';
import { countPool, describeServerOrUnknown } from './servers';
import {
  balancedRouteNullModel,
  balancedStatusCheckFailedModel,
  balancedSuccessModel,
} from './balanced';
import { failoverRouteNullModel, failoverStatusCheckFailedModel, failoverSuccessModel } from './failover';
import type { NodeStatusCardInput, NodeStatusCardModel, NodeStatusSupportItem } from './types';

const UNKNOWN_SERVER = 'unknown';

/* c8 ignore start -- unreachable: exhaustiveness guard, only reachable if PoolFallbackReason grows a new member */
/** Compile-time exhaustiveness guard for a `switch` over a closed union. */
function assertUnreachableFallbackReason(value: never): never {
  throw new Error(`Unhandled pool fallback reason: ${String(value)}`);
}
/* c8 ignore stop */

/**
 * Type predicate for the "ready" branch: data is present and its network
 * matches the currently selected one. Its negation guards the
 * mismatched/initial/checking short-circuit.
 */
function isReadyInput(input: NodeStatusCardInput): input is NodeStatusCardInput & { data: BitcoinStatus } {
  if (input.isLoading || input.isPlaceholderData || !input.data) {
    return false;
  }

  return input.data.network === input.selectedNetwork;
}

function checkingModel(networkTitle: string): NodeStatusCardModel {
  return {
    badges: buildBadges(networkTitle, null),
    headline: 'Checking…',
    tone: 'checking',
    support: [{ key: 'checking', value: `Checking ${networkTitle} node status…` }],
    detail: { kind: 'none' },
    lastKnown: null,
  };
}

/** Sanitized generic connection error text for a minimal/legacy disconnected response. */
function sanitizedError(data: BitcoinStatus): string {
  return data.error && data.error.trim().length > 0 ? data.error : 'Connection error';
}

function legacyModel(data: BitcoinStatus, networkTitle: string): NodeStatusCardModel {
  if (!data.connected) {
    return {
      badges: buildBadges(networkTitle, null),
      headline: 'Offline',
      tone: 'error',
      support: [{ key: 'error', value: sanitizedError(data), tone: 'error' }],
      detail: { kind: 'none' },
      lastKnown: null,
    };
  }

  if (data.pool?.enabled) {
    const count = data.pool.stats?.serverCount ?? data.pool.stats?.servers?.length;
    const support: NodeStatusSupportItem[] = [{ key: 'route', value: 'Pool route unknown' }];

    if (typeof count === 'number') {
      support.push({ key: 'count', value: `${count} servers configured` });
    }

    return {
      badges: buildBadges(networkTitle, null),
      headline: 'Network operational',
      tone: 'success',
      support,
      detail: { kind: 'none' },
      lastKnown: null,
    };
  }

  return {
    badges: buildBadges(networkTitle, 'Single server'),
    headline: 'Operational',
    tone: 'success',
    support: [connectedSupport(data)],
    detail: { kind: 'none' },
    lastKnown: null,
  };
}

function connectedSupport(data: BitcoinStatus): NodeStatusSupportItem {
  const host = formatHost(data.host);
  const heightText = typeof data.blockHeight === 'number' ? ` · height ${formatBlockHeight(data.blockHeight)}` : '';
  return { key: 'connected', value: `Connected to ${host}${heightText}` };
}

/** Successful singleton fallback: `route.transport === 'singleton_fallback'`. */
function fallbackModel(data: BitcoinStatus, op: NodeOperationalStatus, networkTitle: string): NodeStatusCardModel {
  /* c8 ignore next 3 -- unreachable: resolveModel only calls fallbackModel for a singleton_fallback route */
  if (op.route?.transport !== 'singleton_fallback') {
    throw new Error('fallbackModel requires a singleton_fallback route');
  }

  const pool = op.pool;
  const strategy = pool ? strategyLabel(pool.strategy) : null;
  const badges = buildBadges(networkTitle, strategy);
  const host = formatHost(data.host);
  const isFailover = pool?.strategy === 'failover_only';

  switch (op.route.fallbackReason) {
    case 'pool_empty':
      return {
        badges,
        headline: 'Pool fallback active',
        tone: 'warning',
        support: [{ key: 'using', value: `Using singleton ${host} · no pool servers configured`, tone: 'warning' }],
        detail: { kind: 'guidance', text: `No pool servers configured. ${ADMIN_GUIDANCE}` },
        lastKnown: null,
      };
    case 'pool_uninitialized':
    case 'pool_probe_failed':
    case 'pool_circuit_open': {
      const support: NodeStatusSupportItem[] = [];

      if (isFailover && pool) {
        support.push({
          key: 'primary',
          value: `Primary ${describeServerOrUnknown(pool, pool.primaryServerId, UNKNOWN_SERVER)}`,
        });
      }

      support.push({ key: 'using', value: `Using singleton ${host}`, tone: 'warning' });
      support.push({ key: 'pool-unavailable', value: 'pool unavailable', tone: 'warning' });

      if (isFailover && pool) {
        const preferredText = pool.preferredServerId
          ? `Next pool retry ${describeServerOrUnknown(pool, pool.preferredServerId, UNKNOWN_SERVER)}`
          : 'No pool server available';
        support.push({ key: 'next', value: preferredText });
      }

      return {
        badges,
        headline: 'Pool fallback active',
        tone: 'warning',
        support,
        detail: { kind: 'guidance', text: ADMIN_GUIDANCE },
        lastKnown: null,
      };
    }
    /* c8 ignore next 2 -- unreachable: PoolFallbackReason is a closed union, all four members are handled above */
    default:
      return assertUnreachableFallbackReason(op.route.fallbackReason);
  }
}

function configGapModel(op: NodeOperationalStatus, networkTitle: string, hasHost: boolean): NodeStatusCardModel | null {
  const isSingletonGap = op.configuredMode === 'singleton' && op.route === null && !hasHost;
  const isPoolGap = op.configuredMode === 'pool' && op.route === null && (!op.pool || op.pool.servers.length === 0);

  if (!isSingletonGap && !isPoolGap) {
    return null;
  }

  return {
    badges: buildBadges(networkTitle, null),
    headline: isSingletonGap ? 'Node not configured' : 'No servers configured',
    tone: 'neutral',
    support: [{ key: 'guidance', value: ADMIN_GUIDANCE }],
    detail: { kind: 'guidance', text: ADMIN_GUIDANCE },
    lastKnown: null,
  };
}

function offlineSingletonModel(data: BitcoinStatus, networkTitle: string): NodeStatusCardModel {
  return {
    badges: buildBadges(networkTitle, 'Single server'),
    headline: 'Offline',
    tone: 'error',
    support: [{ key: 'error', value: sanitizedError(data), tone: 'error' }],
    detail: { kind: 'none' },
    lastKnown: null,
  };
}

function legacySafePoolModel(networkTitle: string, strategy: string | null): NodeStatusCardModel {
  return {
    badges: buildBadges(networkTitle, strategy),
    headline: 'Network operational',
    tone: 'neutral',
    support: [{ key: 'route', value: 'Pool route unknown' }],
    detail: { kind: 'none' },
    lastKnown: null,
  };
}

function routeFailureModel(data: BitcoinStatus, op: NodeOperationalStatus, networkTitle: string): NodeStatusCardModel {
  if (op.configuredMode === 'singleton') {
    return offlineSingletonModel(data, networkTitle);
  }

  const pool = op.pool;

  /* c8 ignore next 3 -- unreachable: configGapModel already handles an empty/missing pool for configuredMode 'pool' */
  if (!pool || pool.servers.length === 0) {
    return legacySafePoolModel(networkTitle, null);
  }

  const strategy = strategyLabel(pool.strategy);
  const badges = buildBadges(networkTitle, strategy);
  const counts = countPool(pool);

  if (!counts.valid) {
    return legacySafePoolModel(networkTitle, strategy);
  }

  const isFailover = pool.strategy === 'failover_only';

  if (counts.online > 0) {
    return isFailover
      ? failoverStatusCheckFailedModel(badges, pool, counts)
      : balancedStatusCheckFailedModel(badges, pool, counts);
  }

  return isFailover ? failoverRouteNullModel(badges, pool, counts) : balancedRouteNullModel(badges, pool);
}

function successModel(data: BitcoinStatus, op: NodeOperationalStatus, networkTitle: string): NodeStatusCardModel {
  /* c8 ignore next 3 -- unreachable: resolveModel only calls successModel when op.route is non-null */
  if (!op.route) {
    return legacySafePoolModel(networkTitle, null);
  }

  if (op.route.transport === 'singleton') {
    return {
      badges: buildBadges(networkTitle, 'Single server'),
      headline: 'Operational',
      tone: 'success',
      support: [connectedSupport(data)],
      detail: { kind: 'none' },
      lastKnown: null,
    };
  }

  const pool = op.pool;

  if (!pool || pool.servers.length === 0) {
    return legacySafePoolModel(networkTitle, null);
  }

  const counts = countPool(pool);
  const strategy = strategyLabel(pool.strategy);
  const badges = buildBadges(networkTitle, strategy);

  if (!counts.valid) {
    return legacySafePoolModel(networkTitle, strategy);
  }

  if (pool.strategy === 'failover_only' && op.route.transport === 'pool') {
    return failoverSuccessModel({ badges, pool, routeServerId: op.route.serverId, height: data.blockHeight });
  }

  return balancedSuccessModel({ badges, pool, strategyText: strategy, height: data.blockHeight });
}

function resolveModel(data: BitcoinStatus, networkTitle: string): NodeStatusCardModel {
  const op = data.operational;

  if (!op) {
    return legacyModel(data, networkTitle);
  }

  if (op.route && op.route.transport === 'singleton_fallback') {
    return fallbackModel(data, op, networkTitle);
  }

  const gap = configGapModel(op, networkTitle, Boolean(data.host));

  if (gap) {
    return gap;
  }

  if (op.route === null) {
    return routeFailureModel(data, op, networkTitle);
  }

  return successModel(data, op, networkTitle);
}

function evidenceFor(
  data: BitcoinStatus,
  dataUpdatedAt: number,
): { evidenceLabel: 'observed' | 'attempted' | 'received'; evidenceAt: string } {
  const op = data.operational;

  if (op?.route) {
    return { evidenceLabel: 'observed', evidenceAt: safeIsoString(op.route.observedAt) ?? 'unknown' };
  }

  if (op) {
    return { evidenceLabel: 'attempted', evidenceAt: safeIsoString(op.attemptedAt) ?? 'unknown' };
  }

  if (!Number.isFinite(dataUpdatedAt) || dataUpdatedAt <= 0) {
    return { evidenceLabel: 'received', evidenceAt: 'unknown' };
  }

  const received = new Date(dataUpdatedAt).toISOString();
  /* c8 ignore next -- Date#toISOString() output is always a parseable ISO string */
  return { evidenceLabel: 'received', evidenceAt: safeIsoString(received) ?? 'unknown' };
}

function wrapLastKnown(base: NodeStatusCardModel, data: BitcoinStatus, dataUpdatedAt: number): NodeStatusCardModel {
  const { evidenceLabel, evidenceAt } = evidenceFor(data, dataUpdatedAt);

  return {
    ...base,
    tone: 'warning',
    lastKnown: {
      summary: `Last known: ${base.headline}`,
      evidenceLabel,
      evidenceAt,
    },
  };
}

export function buildNodeStatusCardModel(input: NodeStatusCardInput): NodeStatusCardModel {
  const networkTitle = formatNetworkTitle(input.selectedNetwork);

  if (!isReadyInput(input)) {
    return checkingModel(networkTitle);
  }

  const { data } = input;
  const base = resolveModel(data, networkTitle);

  if (!input.isLastKnown) {
    return base;
  }

  return wrapLastKnown(base, data, input.dataUpdatedAt);
}

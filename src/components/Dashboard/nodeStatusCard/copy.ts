/**
 * Pure text/formatting helpers shared across the Node Status presentation
 * builders. No JSX, no branching deeper than a guard clause per function.
 */

import type { NodePoolLoadBalancing } from '../../../api/bitcoin';
import type { NodeStatusBadge, NodeStatusServerAvailabilityText, NodeStatusTone } from './types';

export const ADMIN_GUIDANCE = 'Open Admin → Node Config';

/** Strategy label text; null when strategy cannot be truthfully claimed. */
export function strategyLabel(strategy: NodePoolLoadBalancing | null | undefined): string | null {
  switch (strategy) {
    case 'round_robin':
      return 'Round robin';
    case 'least_connections':
      return 'Least connections';
    case 'failover_only':
      return 'Failover';
    default:
      return null;
  }
}

export function networkBadge(networkTitle: string): NodeStatusBadge {
  return { label: networkTitle, kind: 'network' };
}

export function strategyBadge(label: string): NodeStatusBadge {
  return { label, kind: 'strategy' };
}

/**
 * Builds the badge list: network badge always, strategy badge only when a
 * truthful strategy label is available (never inferred for legacy
 * `pool.enabled` responses with no operational projection).
 */
export function buildBadges(networkTitle: string, strategy: string | null): NodeStatusBadge[] {
  const badges: NodeStatusBadge[] = [networkBadge(networkTitle)];

  if (strategy) {
    badges.push(strategyBadge(strategy));
  }

  return badges;
}

/** Maps the DTO's `ServerAvailability` enum to display text; unknown -> neutral. */
export function availabilityText(
  availability: string | null | undefined,
): NodeStatusServerAvailabilityText {
  switch (availability) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'cooldown':
      return 'Cooldown';
    case 'stale':
      return 'Stale';
    case 'unchecked':
    default:
      return 'Not checked';
  }
}

export function availabilityTone(availability: string | null | undefined): NodeStatusTone {
  switch (availability) {
    case 'online':
      return 'success';
    case 'offline':
      return 'error';
    case 'cooldown':
    case 'stale':
      return 'warning';
    case 'unchecked':
    default:
      return 'neutral';
  }
}

/** Validates an ISO-8601-ish string; returns null rather than risk `Invalid Date`. */
export function safeIsoString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? value : null;
}

/** Falls back to an honest placeholder when the host is missing. */
export function formatHost(host: string | null | undefined): string {
  return host && host.trim().length > 0 ? host : 'unknown host';
}

/** Block height with en-US thousands separators (`900,123`), matching the previous card. */
export function formatBlockHeight(height: number): string {
  return height.toLocaleString('en-US');
}

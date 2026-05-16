/**
 * Canonical admin monitoring service identifiers.
 *
 * These values are the wire/path identifiers for configurable monitoring
 * services, not display labels or container names.
 */

export const MONITORING_SERVICE_IDS = [
  'grafana',
  'prometheus',
  'jaeger',
] as const;

export type MonitoringServiceId = (typeof MONITORING_SERVICE_IDS)[number];

export function isMonitoringServiceId(value: unknown): value is MonitoringServiceId {
  return typeof value === 'string'
    && (MONITORING_SERVICE_IDS as readonly string[]).includes(value);
}

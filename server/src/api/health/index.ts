/**
 * Health Check API
 *
 * Provides comprehensive health status for monitoring and alerting.
 * Aggregates status from database, external services, and internal components.
 */

export { default } from './routes';
export type { HealthStatus, ComponentHealth, HealthResponse } from './types';

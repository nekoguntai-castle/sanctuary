/**
 * Health Check Types
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  latency?: number;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    electrum: ComponentHealth;
    websocket: ComponentHealth;
    sync: ComponentHealth;
    jobQueue: ComponentHealth;
    cacheInvalidation: ComponentHealth;
    startup: ComponentHealth;
    circuitBreakers: ComponentHealth;
    memory: ComponentHealth;
    disk: ComponentHealth;
  };
}

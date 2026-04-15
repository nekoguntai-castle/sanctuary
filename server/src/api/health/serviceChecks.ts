/**
 * Service Health Checks
 *
 * API compatibility wrapper around service-owned health checks.
 */

export { checkElectrum, checkWebSocket, checkSync, checkRedis, checkJobQueue } from '../../services/health';

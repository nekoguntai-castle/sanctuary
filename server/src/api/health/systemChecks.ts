/**
 * System Health Checks
 *
 * API compatibility wrapper around service-owned health checks.
 */

export { checkDatabase, checkDiskSpace, checkMemory } from '../../services/health';

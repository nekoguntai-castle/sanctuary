/**
 * Docker Container Management
 *
 * Secure interface for managing containers via Docker socket proxy.
 * Supports dynamic container names via COMPOSE_PROJECT_NAME for multi-instance deployments.
 */

// Common utilities
export { isDockerProxyAvailable, discoverProjectName } from './common';

// Tor container management
export {
  getTorStatus,
  createTorContainer,
  startTor,
  stopTor,
} from './tor';

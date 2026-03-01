/**
 * Docker Container Management
 *
 * Secure interface for managing containers via Docker socket proxy.
 * Supports dynamic container names via COMPOSE_PROJECT_NAME for multi-instance deployments.
 */

// Common utilities
export { isDockerProxyAvailable } from './common';

// Ollama container management
export {
  getOllamaStatus,
  createOllamaContainer,
  startOllama,
  stopOllama,
} from './ollama';

// Tor container management
export {
  getTorStatus,
  createTorContainer,
  startTor,
  stopTor,
} from './tor';

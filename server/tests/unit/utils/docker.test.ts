import { afterEach, beforeEach, describe } from 'vitest';
/**
 * Docker Container Management Tests
 *
 * Tests for Docker container management functions for Ollama and Tor.
 */

import { registerDockerErrorDiscoveryContracts } from './docker/error-discovery.contracts';
import { registerDockerOllamaLifecycleContracts } from './docker/ollama-lifecycle.contracts';
import { registerDockerStatusContracts } from './docker/status.contracts';
import { registerDockerTorLifecycleContracts } from './docker/tor-lifecycle.contracts';
import { restoreDockerTestEnvironment, setupDockerTestEnvironment } from './docker/dockerTestHarness';

describe('Docker Container Management', () => {
  beforeEach(setupDockerTestEnvironment);
  afterEach(restoreDockerTestEnvironment);

  registerDockerStatusContracts();
  registerDockerOllamaLifecycleContracts();
  registerDockerTorLifecycleContracts();
  registerDockerErrorDiscoveryContracts();
});

import { afterEach, beforeEach, describe } from 'vitest';
/**
 * Docker Container Management Tests
 *
 * Tests for Docker container management functions for Tor.
 */

import { registerDockerErrorDiscoveryContracts } from './docker/error-discovery.contracts';
import { registerDockerStatusContracts } from './docker/status.contracts';
import { registerDockerTorLifecycleContracts } from './docker/tor-lifecycle.contracts';
import { restoreDockerTestEnvironment, setupDockerTestEnvironment } from './docker/dockerTestHarness';

describe('Docker Container Management', () => {
  beforeEach(setupDockerTestEnvironment);
  afterEach(restoreDockerTestEnvironment);

  registerDockerStatusContracts();
  registerDockerTorLifecycleContracts();
  registerDockerErrorDiscoveryContracts();
});

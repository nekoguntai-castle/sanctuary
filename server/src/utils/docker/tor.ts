/**
 * Tor Container Management
 *
 * Secure interface for managing the Tor proxy container via Docker socket proxy.
 * Supports dynamic container names via COMPOSE_PROJECT_NAME for multi-instance deployments.
 */

import { createLogger } from '../logger';
import { getErrorMessage } from '../errors';
import { DOCKER_PROXY_URL, listAllContainers, discoverProjectName } from './common';
import type { ContainerInfo, ContainerStatus, ContainerActionResult } from './types';

const log = createLogger('DOCKER');

// Pattern to match tor containers (supports dynamic project names)
// Container names will be like: {project}-tor-1 or sanctuary-tor
const TOR_CONTAINER_PATTERN = /-tor(-\d+)?$/;

/**
 * Find tor container by pattern
 * Returns the container info if found
 */
async function findTorContainer(): Promise<ContainerInfo | null> {
  try {
    const containers = await listAllContainers();
    if (containers.length === 0) return null;

    // Find container matching the tor pattern (e.g., sanctuary-tor-1 or sanctuary-tor)
    const tor = containers.find((c) =>
      c.Names.some((name) => TOR_CONTAINER_PATTERN.test(name))
    );

    return tor || null;
  } catch (error) {
    log.error('Error finding Tor container', { error });
    return null;
  }
}

/**
 * Get Tor container status
 */
export async function getTorStatus(): Promise<ContainerStatus> {
  try {
    const tor = await findTorContainer();

    if (!tor) {
      return { exists: false, running: false, status: 'not_created' };
    }

    return {
      exists: true,
      running: tor.State === 'running',
      status: tor.State,
      containerId: tor.Id,
    };
  } catch (error) {
    log.error('Error getting Tor status', { error });
    return { exists: false, running: false, status: 'error' };
  }
}

/**
 * Create and start the Tor container
 */
export async function createTorContainer(): Promise<ContainerActionResult> {
  try {
    // Check if already exists
    const status = await getTorStatus();
    if (status.exists) {
      if (status.running) {
        return { success: true, message: 'Tor container is already running' };
      }
      // Start existing container
      return startTor();
    }

    log.info('Creating Tor container...');

    // First, pull the image
    const pullResponse = await fetch(
      `${DOCKER_PROXY_URL}/images/create?fromImage=dperson/torproxy&tag=latest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!pullResponse.ok) {
      const errorText = await pullResponse.text();
      log.warn('Failed to pull Tor image', { status: pullResponse.status, error: errorText });
      return { success: false, message: `Failed to pull Tor image: ${errorText}` };
    }

    // Wait for pull to complete (stream response)
    await pullResponse.text();
    log.info('Tor image pulled successfully');

    // Get the project name from existing containers or use default
    const projectName = await discoverProjectName();

    // Get the network name (Docker Compose format: {project}_{network-name})
    const networkName = `${projectName}_sanctuary-network`;

    // Create the container with network alias so it's resolvable as 'tor'
    const containerConfig = {
      Image: 'dperson/torproxy:latest',
      Env: ['LOCATION='],
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: {
          Type: 'json-file',
          Config: {
            'max-size': '10m',
            'max-file': '3',
          },
        },
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {
            Aliases: ['tor'],
          },
        },
      },
      Labels: {
        'com.docker.compose.project': projectName,
        'com.docker.compose.service': 'tor',
      },
    };

    const createResponse = await fetch(
      `${DOCKER_PROXY_URL}/containers/create?name=${projectName}-tor`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerConfig),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      log.warn('Failed to create Tor container', { status: createResponse.status, error: errorText });
      return { success: false, message: `Failed to create Tor container: ${errorText}` };
    }

    const createResult = (await createResponse.json()) as { Id: string };
    log.info('Tor container created', { id: createResult.Id });

    // Start the container
    const startResponse = await fetch(
      `${DOCKER_PROXY_URL}/containers/${createResult.Id}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (startResponse.status === 204 || startResponse.status === 304) {
      log.info('Tor container started');
      return { success: true, message: 'Tor container created and started successfully' };
    }

    const errorText = await startResponse.text();
    log.warn('Failed to start Tor container', { status: startResponse.status, error: errorText });
    return { success: false, message: `Container created but failed to start: ${errorText}` };
  } catch (error) {
    log.error('Error creating Tor container', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to create Tor container') };
  }
}

/**
 * Start the Tor container
 */
export async function startTor(): Promise<ContainerActionResult> {
  try {
    const status = await getTorStatus();

    if (!status.exists || !status.containerId) {
      // Try to create and start
      return createTorContainer();
    }

    if (status.running) {
      return { success: true, message: 'Tor is already running' };
    }

    // Start the container using its ID
    const response = await fetch(
      `${DOCKER_PROXY_URL}/containers/${status.containerId}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 204 || response.status === 304) {
      log.info('Tor container started');
      return { success: true, message: 'Tor started successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to start Tor', { status: response.status, error: errorText });
    return { success: false, message: `Failed to start Tor: ${errorText}` };
  } catch (error) {
    log.error('Error starting Tor', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to start Tor') };
  }
}

/**
 * Stop the Tor container
 */
export async function stopTor(): Promise<ContainerActionResult> {
  try {
    const status = await getTorStatus();

    if (!status.exists || !status.containerId) {
      return { success: true, message: 'Tor container does not exist' };
    }

    if (!status.running) {
      return { success: true, message: 'Tor is already stopped' };
    }

    // Stop the container using its ID (with 10 second timeout)
    const response = await fetch(
      `${DOCKER_PROXY_URL}/containers/${status.containerId}/stop?t=10`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 204 || response.status === 304) {
      log.info('Tor container stopped');
      return { success: true, message: 'Tor stopped successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to stop Tor', { status: response.status, error: errorText });
    return { success: false, message: `Failed to stop Tor: ${errorText}` };
  } catch (error) {
    log.error('Error stopping Tor', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to stop Tor') };
  }
}

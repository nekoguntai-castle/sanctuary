/**
 * Ollama Container Management
 *
 * Secure interface for managing the Ollama container via Docker socket proxy.
 * Supports dynamic container names via COMPOSE_PROJECT_NAME for multi-instance deployments.
 */

import { createLogger } from '../logger';
import { getErrorMessage } from '../errors';
import { DOCKER_PROXY_URL, listAllContainers, discoverProjectName } from './common';
import type { ContainerInfo, ContainerStatus, ContainerActionResult } from './types';

const log = createLogger('DOCKER');

// Pattern to match ollama containers (supports dynamic project names)
// Container names will be like: {project}-ollama-1
const OLLAMA_CONTAINER_PATTERN = /-ollama-\d+$/;

/**
 * Find ollama container by pattern
 * Returns the container info if found
 */
async function findOllamaContainer(): Promise<ContainerInfo | null> {
  try {
    const containers = await listAllContainers();
    if (containers.length === 0) return null;

    // Find container matching the ollama pattern (e.g., sanctuary-ollama-1)
    const ollama = containers.find((c) =>
      c.Names.some((name) => OLLAMA_CONTAINER_PATTERN.test(name))
    );

    return ollama || null;
  } catch (error) {
    log.error('Error finding Ollama container', { error });
    return null;
  }
}

/**
 * Get Ollama container status
 */
export async function getOllamaStatus(): Promise<ContainerStatus> {
  try {
    const ollama = await findOllamaContainer();

    if (!ollama) {
      return { exists: false, running: false, status: 'not_created' };
    }

    return {
      exists: true,
      running: ollama.State === 'running',
      status: ollama.State,
      containerId: ollama.Id,
    };
  } catch (error) {
    log.error('Error getting Ollama status', { error });
    return { exists: false, running: false, status: 'error' };
  }
}

/**
 * Create and start the Ollama container
 */
export async function createOllamaContainer(): Promise<ContainerActionResult> {
  try {
    // Check if already exists
    const status = await getOllamaStatus();
    if (status.exists) {
      if (status.running) {
        return { success: true, message: 'Ollama container is already running' };
      }
      // Start existing container
      return startOllama();
    }

    log.info('Creating Ollama container...');

    // First, pull the image
    const pullResponse = await fetch(
      `${DOCKER_PROXY_URL}/images/create?fromImage=ollama/ollama&tag=latest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!pullResponse.ok) {
      const errorText = await pullResponse.text();
      log.warn('Failed to pull Ollama image', { status: pullResponse.status, error: errorText });
      return { success: false, message: `Failed to pull Ollama image: ${errorText}` };
    }

    // Wait for pull to complete (stream response)
    await pullResponse.text();
    log.info('Ollama image pulled successfully');

    // Get the project name from existing containers or use default
    const projectName = await discoverProjectName();

    // Get the network name (Docker Compose format: {project}_{network-name})
    const networkName = `${projectName}_sanctuary-network`;
    const volumeName = `${projectName}_ollama_data`;

    // Create the container with network alias so it's resolvable as 'ollama'
    const containerConfig = {
      Image: 'ollama/ollama:latest',
      Env: ['OLLAMA_HOST=0.0.0.0'],
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [`${volumeName}:/root/.ollama`],
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
            Aliases: ['ollama'],
          },
        },
      },
      Labels: {
        'com.docker.compose.project': projectName,
        'com.docker.compose.service': 'ollama',
      },
      Healthcheck: {
        Test: ['CMD', 'ollama', 'list'],
        Interval: 30000000000, // 30s in nanoseconds
        Timeout: 10000000000,  // 10s in nanoseconds
        Retries: 3,
        StartPeriod: 30000000000, // 30s in nanoseconds
      },
    };

    const createResponse = await fetch(
      `${DOCKER_PROXY_URL}/containers/create?name=${projectName}-ollama-1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerConfig),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      log.warn('Failed to create Ollama container', { status: createResponse.status, error: errorText });
      return { success: false, message: `Failed to create Ollama container: ${errorText}` };
    }

    const createResult = (await createResponse.json()) as { Id: string };
    log.info('Ollama container created', { id: createResult.Id });

    // Start the container
    const startResponse = await fetch(
      `${DOCKER_PROXY_URL}/containers/${createResult.Id}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (startResponse.status === 204 || startResponse.status === 304) {
      log.info('Ollama container started');
      return { success: true, message: 'Ollama container created and started successfully' };
    }

    const errorText = await startResponse.text();
    log.warn('Failed to start Ollama container', { status: startResponse.status, error: errorText });
    return { success: false, message: `Container created but failed to start: ${errorText}` };
  } catch (error) {
    log.error('Error creating Ollama container', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to create Ollama container') };
  }
}

/**
 * Start the Ollama container (creates it if it doesn't exist)
 */
export async function startOllama(): Promise<ContainerActionResult> {
  try {
    const status = await getOllamaStatus();

    if (!status.exists || !status.containerId) {
      // Try to create and start
      return createOllamaContainer();
    }

    if (status.running) {
      return { success: true, message: 'Ollama is already running' };
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
      log.info('Ollama container started');
      return { success: true, message: 'Ollama started successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to start Ollama', { status: response.status, error: errorText });
    return { success: false, message: `Failed to start Ollama: ${errorText}` };
  } catch (error) {
    log.error('Error starting Ollama', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to start Ollama') };
  }
}

/**
 * Stop the Ollama container
 */
export async function stopOllama(): Promise<ContainerActionResult> {
  try {
    const status = await getOllamaStatus();

    if (!status.exists || !status.containerId) {
      return { success: true, message: 'Ollama container does not exist' };
    }

    if (!status.running) {
      return { success: true, message: 'Ollama is already stopped' };
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
      log.info('Ollama container stopped');
      return { success: true, message: 'Ollama stopped successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to stop Ollama', { status: response.status, error: errorText });
    return { success: false, message: `Failed to stop Ollama: ${errorText}` };
  } catch (error) {
    log.error('Error stopping Ollama', { error });
    return { success: false, message: getErrorMessage(error, 'Failed to stop Ollama') };
  }
}

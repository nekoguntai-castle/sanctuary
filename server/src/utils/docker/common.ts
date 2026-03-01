/**
 * Docker Common Utilities
 *
 * Shared utilities for Docker container management: proxy availability check,
 * project name discovery, and container listing.
 */

import { createLogger } from '../logger';
import type { ContainerInfo } from './types';

const log = createLogger('DOCKER');

// Docker proxy URL (set via environment variable)
export const DOCKER_PROXY_URL = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';

/**
 * Check if Docker proxy is available
 */
export async function isDockerProxyAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${DOCKER_PROXY_URL}/containers/json?limit=1`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List all containers from Docker proxy
 */
export async function listAllContainers(): Promise<ContainerInfo[]> {
  const response = await fetch(`${DOCKER_PROXY_URL}/containers/json?all=true`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    log.warn('Failed to list containers', { status: response.status });
    return [];
  }

  return (await response.json()) as ContainerInfo[];
}

/**
 * Discover the Docker Compose project name from existing sanctuary containers
 */
export async function discoverProjectName(): Promise<string> {
  let projectName = 'sanctuary';

  try {
    const containers = await listAllContainers();
    const sanctuaryContainer = containers.find(c =>
      c.Names.some(n => n.includes('-backend-') || n.includes('-frontend-'))
    );
    if (sanctuaryContainer) {
      const name = sanctuaryContainer.Names[0].replace(/^\//, '');
      const match = name.match(/^(.+?)-(backend|frontend)/);
      if (match) projectName = match[1];
    }
  } catch (error) {
    log.debug('Could not discover project name, using default', { error });
  }

  return projectName;
}

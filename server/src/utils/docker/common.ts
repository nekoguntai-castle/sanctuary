/**
 * Docker Common Utilities
 *
 * Shared utilities for Docker container management: proxy availability check,
 * project name discovery, and container listing.
 */

import { createLogger } from '../logger';
import type { ContainerInfo } from './types';

const log = createLogger('UTIL:DOCKER');

// Docker proxy URL (set via environment variable)
export const DOCKER_PROXY_URL = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';

const DEFAULT_PROJECT_NAME = 'sanctuary';
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const PROJECT_DISCOVERY_SERVICES = new Set(['backend', 'frontend']);

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

function getContainerLabel(container: ContainerInfo, key: string): string | null {
  const value = container.Labels?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function discoverProjectNameFromLabels(containers: ContainerInfo[]): string | null {
  for (const container of containers) {
    const service = getContainerLabel(container, COMPOSE_SERVICE_LABEL);
    const project = getContainerLabel(container, COMPOSE_PROJECT_LABEL);

    if (project && service && PROJECT_DISCOVERY_SERVICES.has(service)) {
      return project;
    }
  }

  return null;
}

function normalizeContainerName(name: string): string {
  return name.replace(/^\//, '');
}

function isProjectDiscoveryContainerName(name: string): boolean {
  return name.includes('-backend-') || name.includes('-frontend-');
}

function discoverProjectNameFromNames(containers: ContainerInfo[]): string | null {
  const sanctuaryContainerName = containers
    .flatMap((container) => container.Names)
    .map(normalizeContainerName)
    .find(isProjectDiscoveryContainerName);

  if (!sanctuaryContainerName) {
    return null;
  }

  const match = sanctuaryContainerName.match(/^(.+?)-(backend|frontend)/);
  return match?.[1] ?? null;
}

/**
 * Discover the Docker Compose project name from existing sanctuary containers
 */
export async function discoverProjectName(): Promise<string> {
  try {
    const containers = await listAllContainers();
    return discoverProjectNameFromLabels(containers)
      ?? discoverProjectNameFromNames(containers)
      ?? DEFAULT_PROJECT_NAME;
  } catch (error) {
    log.debug('Could not discover project name, using default', { error });
  }

  return DEFAULT_PROJECT_NAME;
}

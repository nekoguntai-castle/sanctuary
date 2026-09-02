import { vi } from 'vitest';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const dockerTestMocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', dockerTestMocks.mockFetch);

export const mockFetch = dockerTestMocks.mockFetch;
export const TOR_ID = 'a'.repeat(64);
export const TOR_OWNERSHIP_LABELS = {
  'io.sanctuary.project': 'sanctuary',
  'io.sanctuary.deployment-id': 'deploy-sanctuary',
  'io.sanctuary.owner-id': 'owner-test',
  'io.sanctuary.resource-class': 'compose_container',
  'io.sanctuary.lifecycle': 'deployment',
  'io.sanctuary.cleanup-policy': 'exact_delete',
  'io.sanctuary.created-at': '2026-09-01T00:00:00.000Z',
  'io.sanctuary.created-by-release': 'v0.8.69',
  'io.sanctuary.created-by-commit': 'b'.repeat(40),
  'io.sanctuary.creation-run-id': 'run-test',
  'com.docker.compose.project': 'sanctuary',
  'com.docker.compose.service': 'tor',
};

export function ownedTorSummary(
  state = 'running',
  overrides: Record<string, unknown> = {},
) {
  return {
    Id: TOR_ID,
    Names: ['/sanctuary-tor'],
    Labels: TOR_OWNERSHIP_LABELS,
    State: state,
    Status: state,
    ...overrides,
  };
}

export function ownedTorInspect(overrides: Record<string, unknown> = {}) {
  return {
    Id: TOR_ID,
    Name: '/sanctuary-tor',
    Config: { Labels: TOR_OWNERSHIP_LABELS },
    State: {
      Status: 'created',
      Running: false,
      Paused: false,
      Restarting: false,
      Dead: false,
      StartedAt: '',
    },
    ...overrides,
  };
}

const originalEnv = { ...process.env };

export function setupDockerTestEnvironment(): void {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.DOCKER_PROXY_URL = 'http://docker-proxy:2375';
  process.env.SANCTUARY_PROJECT = 'sanctuary';
  process.env.SANCTUARY_DEPLOYMENT_ID = 'deploy-sanctuary';
  process.env.SANCTUARY_OWNER_ID = 'owner-test';
  process.env.SANCTUARY_RESOURCE_LIFECYCLE = 'deployment';
  process.env.SANCTUARY_CLEANUP_CREATED_AT = '2026-09-01T00:00:00.000Z';
  process.env.SANCTUARY_RELEASE = 'v0.8.69';
  process.env.SANCTUARY_COMMIT = 'b'.repeat(40);
  process.env.SANCTUARY_OPERATION_RUN_ID = 'run-test';
}

export function restoreDockerTestEnvironment(): void {
  process.env = originalEnv;
}

export {
  createTorContainer,
  discoverProjectName,
  getTorStatus,
  isDockerProxyAvailable,
  startTor,
  stopTor,
} from '../../../../src/utils/docker';

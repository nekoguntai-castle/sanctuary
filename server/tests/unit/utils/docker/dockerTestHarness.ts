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

const originalEnv = { ...process.env };

export function setupDockerTestEnvironment(): void {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.DOCKER_PROXY_URL = 'http://docker-proxy:2375';
}

export function restoreDockerTestEnvironment(): void {
  process.env = originalEnv;
}

export {
  createOllamaContainer,
  createTorContainer,
  discoverProjectName,
  getOllamaStatus,
  getTorStatus,
  isDockerProxyAvailable,
  startOllama,
  startTor,
  stopOllama,
  stopTor,
} from '../../../../src/utils/docker';

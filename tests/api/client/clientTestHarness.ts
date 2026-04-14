import { vi } from 'vitest';

const clientApiMocks = vi.hoisted(() => ({
  mockDownloadBlob: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
  mockScheduleRefreshFromHeader: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../utils/download', () => ({
  downloadBlob: (...args: unknown[]) => clientApiMocks.mockDownloadBlob(...args),
}));

vi.mock('../../../src/api/refresh', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/refresh')>(
    '../../../src/api/refresh',
  );
  return {
    ...actual,
    scheduleRefreshFromHeader: (iso: string) => clientApiMocks.mockScheduleRefreshFromHeader(iso),
    refreshAccessToken: () => clientApiMocks.mockRefreshAccessToken(),
  };
});

vi.stubGlobal('import', { meta: { env: {} } });

import * as apiClientModule from '../../../src/api/client';

const { mockDownloadBlob, mockRefreshAccessToken, mockScheduleRefreshFromHeader } = clientApiMocks;

const apiClient = apiClientModule.default;
const { ApiError } = apiClientModule;

export { ApiError, apiClient, mockDownloadBlob, mockRefreshAccessToken, mockScheduleRefreshFromHeader };

export const mockFetch = vi.fn();

export const clearDocumentCookies = () => {
  if (typeof document !== 'undefined') {
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0]?.trim();
      if (name) document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
  }
};

export const setupApiClientTest = () => {
  vi.clearAllMocks();
  global.fetch = mockFetch;
  mockScheduleRefreshFromHeader.mockReset();
  mockRefreshAccessToken.mockReset();
  clearDocumentCookies();
};

export const cleanupApiClientTest = () => {
  vi.restoreAllMocks();
};

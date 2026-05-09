import { beforeEach, vi } from "vitest";

const apiClientMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  fetchBlob: vi.fn(),
  fetch: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

// Phase 4: setToken/getToken were removed from the apiClient surface.
// Browser auth lives in HttpOnly cookies, so this mock only covers request verbs.
vi.mock("../../src/api/client", () => ({
  default: {
    delete: (...args: unknown[]) => apiClientMocks.delete(...args),
    fetchBlob: (...args: unknown[]) => apiClientMocks.fetchBlob(...args),
    get: (...args: unknown[]) => apiClientMocks.get(...args),
    patch: (...args: unknown[]) => apiClientMocks.patch(...args),
    post: (...args: unknown[]) => apiClientMocks.post(...args),
    put: (...args: unknown[]) => apiClientMocks.put(...args),
  },
  API_BASE_URL: "/api/v1",
}));

export const mockDelete = apiClientMocks.delete;
export const mockFetchBlob = apiClientMocks.fetchBlob;
export const mockFetch = apiClientMocks.fetch;
export const mockGet = apiClientMocks.get;
export const mockPatch = apiClientMocks.patch;
export const mockPost = apiClientMocks.post;
export const mockPut = apiClientMocks.put;

export function setupRemainingApiModuleMocks(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = apiClientMocks.fetch as unknown as typeof fetch;
  });
}

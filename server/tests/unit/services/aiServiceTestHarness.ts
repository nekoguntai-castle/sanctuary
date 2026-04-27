import { afterEach, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  systemSettingFindMany: vi.fn(),
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("../../../src/repositories", () => ({
  systemSettingRepository: {
    findByKeys: mocks.systemSettingFindMany,
  },
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/encryption", () => ({
  decrypt: mocks.decrypt,
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith("encrypted:")),
}));

export function setting(key: string, value: unknown) {
  return { key, value: JSON.stringify(value) };
}

export function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

export function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

export function getAiServiceMocks() {
  return mocks;
}

export function mockConfiguredAiSettings() {
  mocks.systemSettingFindMany.mockResolvedValue([
    setting("aiEnabled", true),
    setting("aiEndpoint", "http://ollama:11434"),
    setting("aiModel", "llama3.2"),
  ] as any);
}

export function setupAiServiceTest() {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.systemSettingFindMany.mockResolvedValue([]);
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";

import { detectProviderModels } from "../../ai-proxy/src/providerDetection";

const baseConfig = {
  enabled: true,
  endpoint: "",
  model: "",
};

describe("AI proxy provider detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detects LM Studio models on private LAN endpoints without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "qwen/qwen3.6-35b-a3b" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectProviderModels(
      { ...baseConfig, providerType: "openai-compatible" },
      "http://10.114.123.214:1234",
      "openai-compatible",
    );

    expect(result).toMatchObject({
      found: true,
      providerType: "openai-compatible",
      endpoint: "http://10.114.123.214:1234",
      models: [{ name: "qwen/qwen3.6-35b-a3b", size: 0, modifiedAt: "" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.114.123.214:1234/v1/models",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
    const requestOptions = fetchMock.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect(requestOptions?.headers).not.toHaveProperty("Authorization");
  });

  it("reports blocked public HTTP endpoints instead of probing them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectProviderModels(
      baseConfig,
      "http://203.0.113.10:1234",
      "openai-compatible",
    );

    expect(result).toMatchObject({
      found: false,
      blockedReason: "host_not_allowed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestProviderEndpoint: vi.fn(),
}));

vi.mock("../../llm-egress-proxy/src/providerHttpClient", () => ({
  requestProviderEndpoint: mocks.requestProviderEndpoint,
}));

import {
  listProviderModels,
  mapOpenAICompatibleModels,
} from "../../llm-egress-proxy/src/providerModels";

describe("LLM egress proxy provider model listing", () => {
  beforeEach(() => {
    mocks.requestProviderEndpoint.mockReset();
  });

  it("maps OpenAI-compatible /v1/models responses into provider model options", () => {
    expect(
      mapOpenAICompatibleModels({
        data: [
          { id: "lmstudio-model", created: 1_700_000_000 },
          { id: "" },
          { id: 123 },
        ],
      }),
    ).toEqual([
      {
        name: "lmstudio-model",
        size: 0,
        modifiedAt: "2023-11-14T22:13:20.000Z",
      },
    ]);
  });

  it("lists LM Studio models from OpenAI-compatible endpoints without requiring an API key", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://lmstudio.local:1234/v1/models"),
      headers: {},
      body: Buffer.from(
        JSON.stringify({ data: [{ id: "lmstudio-community/model" }] }),
      ),
    });

    await expect(
      listProviderModels(
        {
          enabled: true,
          endpoint: "http://lmstudio.local:1234/v1",
          model: "",
          providerType: "openai-compatible",
        },
        "http://lmstudio.local:1234/v1",
      ),
    ).resolves.toEqual([
      {
        name: "lmstudio-community/model",
        size: 0,
        modifiedAt: "",
      },
    ]);

    expect(mocks.requestProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://lmstudio.local:1234/v1/models",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 5000,
      }),
    );
  });

  it("continues to list Ollama models with the native tags API", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://host.docker.internal:11434/api/tags"),
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          models: [
            {
              name: "llama3.2:3b",
              size: 2_000_000_000,
              modified_at: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      ),
    });

    await expect(
      listProviderModels(
        {
          enabled: true,
          endpoint: "http://host.docker.internal:11434",
          model: "",
          providerType: "ollama",
        },
        "http://host.docker.internal:11434",
      ),
    ).resolves.toEqual([
      {
        name: "llama3.2:3b",
        size: 2_000_000_000,
        modifiedAt: "2026-04-01T00:00:00Z",
      },
    ]);

    expect(mocks.requestProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://host.docker.internal:11434/api/tags",
        timeoutMs: 5000,
      }),
    );
  });

  it("rejects malformed bounded provider responses", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://host.docker.internal:11434/api/tags"),
      headers: {},
      body: Buffer.from("not-json"),
    });

    await expect(
      listProviderModels(
        {
          enabled: true,
          endpoint: "http://host.docker.internal:11434",
          model: "",
          providerType: "ollama",
        },
        "http://host.docker.internal:11434",
      ),
    ).rejects.toThrow("Invalid JSON response from Ollama endpoint");
  });
});

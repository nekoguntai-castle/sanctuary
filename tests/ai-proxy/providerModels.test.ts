import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listProviderModels,
  mapOpenAICompatibleModels,
} from "../../ai-proxy/src/providerModels";

const fetchMock = vi.fn();

describe("AI proxy provider model listing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps OpenAI-compatible /v1/models responses into installed model options", () => {
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "lmstudio-community/model" }],
      }),
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

    expect(fetchMock).toHaveBeenCalledWith(
      "http://lmstudio.local:1234/v1/models",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("continues to list Ollama models with the native tags API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [
          {
            name: "llama3.2:3b",
            size: 2_000_000_000,
            modified_at: "2026-04-01T00:00:00Z",
          },
        ],
      }),
    });

    await expect(
      listProviderModels(
        {
          enabled: true,
          endpoint: "http://ollama:11434",
          model: "",
          providerType: "ollama",
        },
        "http://ollama:11434",
      ),
    ).resolves.toEqual([
      {
        name: "llama3.2:3b",
        size: 2_000_000_000,
        modifiedAt: "2026-04-01T00:00:00Z",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

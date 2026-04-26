import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callExternalAI,
  callExternalAIWithMessages,
} from "../../ai-proxy/src/aiClient";

const fetchMock = vi.fn();

function okChatResponse(content: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
  };
}

describe("AI proxy AI client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends provider API keys only as authorization headers", async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse(" ok "));

    const result = await callExternalAI(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
        providerType: "ollama",
        apiKey: "provider-secret",
      },
      "say ok",
    );

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer provider-secret",
        },
        body: expect.not.stringContaining("provider-secret"),
      }),
    );
  });

  it("omits provider authorization when no API key is configured", async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse("hello"));

    await callExternalAIWithMessages(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/v1/chat/completions",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("fails closed without calling disallowed public endpoints", async () => {
    const result = await callExternalAI(
      {
        enabled: true,
        endpoint: "http://203.0.113.10:11434",
        model: "llama3",
      },
      "say ok",
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callExternalAI,
  callExternalAIWithMessages,
  callExternalAIWithMessagesResult,
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

  it("sends bounded request options for local-model planning calls", async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse(" {\"toolCalls\":[]} "));

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      },
      [{ role: "user", content: "plan" }],
      {
        timeoutMs: 1234,
        temperature: 0,
        maxTokens: 512,
      },
    );

    expect(result).toEqual({ ok: true, content: "{\"toolCalls\":[]}" });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "llama3",
      temperature: 0,
      max_tokens: 512,
    });
  });

  it("can use reasoning content for structured local-model planner calls", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: " {\"toolCalls\":[]} ",
            },
          },
        ],
      }),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "qwen3",
      },
      [{ role: "user", content: "plan" }],
      {
        allowReasoningContent: true,
      },
    );

    expect(result).toEqual({ ok: true, content: "{\"toolCalls\":[]}" });
  });

  it("rejects empty content when reasoning fallback is not enabled", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "thinking only",
            },
          },
        ],
      }),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "qwen3",
      },
      [{ role: "user", content: "answer" }],
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_response",
      message: "AI endpoint response did not include message content",
    });
  });

  it("returns structured timeout details for proxy callers", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValueOnce(abortError);

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
      { timeoutMs: 25 },
    );

    expect(result).toEqual({
      ok: false,
      reason: "timeout",
      message: "AI endpoint request timed out after 25ms",
    });
  });

  it("returns structured upstream status details for proxy callers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue("rate limited"),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://ollama:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
    );

    expect(result).toEqual({
      ok: false,
      reason: "http_error",
      message: "AI endpoint returned status 429: rate limited",
      status: 429,
    });
  });

  it("accepts OpenAI-compatible /v1 base URLs without duplicating the version path", async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse("ok"));

    await callExternalAI(
      {
        enabled: true,
        endpoint: "http://lmstudio.local:1234/v1",
        model: "local-model",
        providerType: "openai-compatible",
      },
      "say ok",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://lmstudio.local:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
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

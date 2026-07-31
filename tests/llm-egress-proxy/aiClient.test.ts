import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestProviderEndpoint: vi.fn(),
}));

vi.mock("../../llm-egress-proxy/src/providerHttpClient", () => ({
  requestProviderEndpoint: mocks.requestProviderEndpoint,
}));

import {
  callExternalAI,
  callExternalAIWithMessages,
  callExternalAIWithMessagesResult,
} from "../../llm-egress-proxy/src/aiClient";

function okChatResponse(content: string) {
  return {
    ok: true,
    status: 200,
    url: new URL("http://host.docker.internal:11434/v1/chat/completions"),
    headers: {},
    body: Buffer.from(JSON.stringify({ choices: [{ message: { content } }] })),
  };
}

describe("LLM egress proxy AI client", () => {
  beforeEach(() => {
    mocks.requestProviderEndpoint.mockReset();
  });

  it("sends provider API keys only as authorization headers", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce(okChatResponse(" ok "));

    const result = await callExternalAI(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3",
        providerType: "ollama",
        apiKey: "provider-secret",
      },
      "say ok",
    );

    expect(result).toBe("ok");
    expect(mocks.requestProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://host.docker.internal:11434/v1/chat/completions",
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
    mocks.requestProviderEndpoint.mockResolvedValueOnce(
      okChatResponse("hello"),
    );

    await callExternalAIWithMessages(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
    );

    expect(mocks.requestProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://host.docker.internal:11434/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("sends bounded request options for local-model planning calls", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce(
      okChatResponse(' {"toolCalls":[]} '),
    );

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3",
      },
      [{ role: "user", content: "plan" }],
      {
        timeoutMs: 1234,
        temperature: 0,
        maxTokens: 512,
      },
    );

    expect(result).toEqual({ ok: true, content: '{"toolCalls":[]}' });
    const requestBody = JSON.parse(
      mocks.requestProviderEndpoint.mock.calls[0][0].body as string,
    );
    expect(requestBody).toMatchObject({
      model: "llama3",
      temperature: 0,
      max_tokens: 512,
    });
  });

  it("can use reasoning content for structured local-model planner calls", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://host.docker.internal:11434/v1/chat/completions"),
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: ' {"toolCalls":[]} ',
              },
            },
          ],
        }),
      ),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "qwen3",
      },
      [{ role: "user", content: "plan" }],
      {
        allowReasoningContent: true,
      },
    );

    expect(result).toEqual({ ok: true, content: '{"toolCalls":[]}' });
  });

  it("rejects empty content when reasoning fallback is not enabled", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://host.docker.internal:11434/v1/chat/completions"),
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "thinking only",
              },
            },
          ],
        }),
      ),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
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
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    mocks.requestProviderEndpoint.mockRejectedValueOnce(abortError);

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
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
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: false,
      status: 429,
      url: new URL("http://host.docker.internal:11434/v1/chat/completions"),
      headers: {},
      body: Buffer.from("rate limited"),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
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

  it("maps oversized provider responses to a bounded invalid-response failure", async () => {
    const error = new Error("sensitive transport details");
    error.name = "ProviderResponseTooLargeError";
    mocks.requestProviderEndpoint.mockRejectedValueOnce(error);

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_response",
      message: "AI endpoint response exceeded the response size limit",
    });
  });

  it("maps malformed bounded response bodies to invalid-response failures", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: new URL("http://host.docker.internal:11434/v1/chat/completions"),
      headers: {},
      body: Buffer.from("not-json"),
    });

    const result = await callExternalAIWithMessagesResult(
      {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3",
      },
      [{ role: "user", content: "hello" }],
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_response",
      message: "Invalid JSON response from AI endpoint",
    });
  });

  it("accepts OpenAI-compatible /v1 base URLs without duplicating the version path", async () => {
    mocks.requestProviderEndpoint.mockResolvedValueOnce(okChatResponse("ok"));

    await callExternalAI(
      {
        enabled: true,
        endpoint: "http://lmstudio.local:1234/v1",
        model: "local-model",
        providerType: "openai-compatible",
      },
      "say ok",
    );

    expect(mocks.requestProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://lmstudio.local:1234/v1/chat/completions",
        method: "POST",
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
    expect(mocks.requestProviderEndpoint).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamModelPull } from "../../llm-egress-proxy/src/modelPull";

const fetchMock = vi.fn();
const encoder = new TextEncoder();

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function okResponse(body?: ReadableStream<Uint8Array>) {
  return {
    ok: true,
    body,
  };
}

describe("LLM egress proxy model pull streaming", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams Ollama pull progress to the backend callback", async () => {
    fetchMock.mockImplementation((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/internal/ai/pull-progress")) {
        return Promise.resolve({ ok: true });
      }
      if (target.endsWith("/api/pull")) {
        return Promise.resolve(
          okResponse(
            streamFromText(
              [
                '{"status":"pulling manifest"}',
                '{"status":"verifying sha256","completed":5,"total":10,"digest":"sha256:abc"}',
                '{"status":"success"}',
                "",
              ].join("\n"),
            ),
          ),
        );
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await streamModelPull(
      "llama3.2",
      "http://host.docker.internal:11434",
      "http://backend:3001",
    );

    const progressBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/internal/ai/pull-progress"))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));

    expect(progressBodies).toEqual([
      { model: "llama3.2", status: "pulling" },
      {
        model: "llama3.2",
        status: "pulling",
        completed: 0,
        total: 0,
      },
      {
        model: "llama3.2",
        status: "verifying",
        completed: 5,
        total: 10,
        digest: "sha256:abc",
      },
      {
        model: "llama3.2",
        status: "complete",
        completed: 0,
        total: 0,
      },
      { model: "llama3.2", status: "complete" },
    ]);
  });

  it("reports pull failures and continues when progress callbacks fail", async () => {
    fetchMock.mockImplementation((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/internal/ai/pull-progress")) {
        return Promise.reject(new Error("backend unavailable"));
      }
      if (target.endsWith("/api/pull")) {
        return Promise.resolve({
          ok: false,
          text: vi.fn().mockResolvedValue("model not found"),
        });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(
      streamModelPull(
        "missing-model",
        "http://host.docker.internal:11434",
        "http://backend:3001",
      ),
    ).resolves.toBeUndefined();

    const pullCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/pull"),
    );
    expect(pullCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "missing-model", stream: true }),
    });
  });

  it("reports an error when the provider response has no stream body", async () => {
    fetchMock.mockImplementation((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/internal/ai/pull-progress")) {
        return Promise.resolve({ ok: true });
      }
      if (target.endsWith("/api/pull")) {
        return Promise.resolve(okResponse());
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await streamModelPull(
      "llama3.2",
      "http://host.docker.internal:11434",
      "http://backend:3001",
    );

    const progressBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/internal/ai/pull-progress"))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));

    expect(progressBodies.at(-1)).toEqual({
      model: "llama3.2",
      status: "error",
      error: "No response body",
    });
  });
});

import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderResponseTooLargeError,
  requestPinnedProviderAddress,
  type ProviderNativeRequest,
} from "../../llm-egress-proxy/src/providerNativeTransport";

interface MockResponse extends EventEmitter {
  destroy: (error?: Error) => void;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  statusCode?: number;
}

interface MockRequest extends EventEmitter {
  destroy: (error?: Error) => void;
  end: (body?: Buffer) => void;
}

describe("provider pinned native transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pins HTTPS to the validated address while preserving Host and TLS SNI", async () => {
    const { request, response } = mockResponse({
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
      rawHeaders: ["Location", "http://127.0.0.1/private"],
      chunks: ["redirect"],
    });
    const spy = vi.spyOn(https, "request").mockImplementationOnce(((
      options: http.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      expect(options).toMatchObject({
        agent: false,
        hostname: "93.184.216.34",
        method: "POST",
        path: "/v1/chat?stream=false",
        port: 443,
        protocol: "https:",
        servername: "models.example",
      });
      expect(options.headers).toMatchObject({
        Host: "models.example",
        "Accept-Encoding": "identity",
        Authorization: "Bearer secret",
      });
      callback?.(response as never);
      return request as never;
    }) as unknown as typeof https.request);

    await expect(
      requestPinnedProviderAddress(
        makeInput({
          url: new URL("https://models.example/v1/chat?stream=false"),
          headers: { Authorization: "Bearer secret", host: "attacker.test" },
        }),
      ),
    ).resolves.toEqual({
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
      locationHeaders: ["http://127.0.0.1/private"],
      body: Buffer.from("redirect"),
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("uses native HTTP, preserves an explicit original port, and sends the body", async () => {
    const body = Buffer.from("request-body");
    const { request, response } = mockResponse({ status: 200, chunks: ["ok"] });
    vi.spyOn(http, "request").mockImplementationOnce(((
      options: http.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      expect(options).toMatchObject({
        hostname: "127.0.0.1",
        port: "11434",
        path: "/api",
        agent: false,
      });
      expect(options).not.toHaveProperty("servername");
      expect(options.headers).toMatchObject({ Host: "ollama.local:11434" });
      callback?.(response as never);
      return request as never;
    }) as unknown as typeof http.request);

    const pending = requestPinnedProviderAddress(
      makeInput({
        url: new URL("http://ollama.local:11434/api"),
        resolvedAddress: "127.0.0.1",
        body,
      }),
    );

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(request.end).toHaveBeenCalledWith(body);
  });

  it.each([
    ["a hostname", { resolvedAddress: "models.example" }],
    ["a non-HTTP URL", { url: new URL("ftp://models.example/file") }],
    ["URL credentials", { url: new URL("https://user:pass@models.example/") }],
    ["an empty method", { method: " " }],
    ["a negative byte cap", { maxResponseBytes: -1 }],
    ["a fractional byte cap", { maxResponseBytes: 1.5 }],
  ])("rejects %s before opening a socket", async (_label, override) => {
    const httpsSpy = vi.spyOn(https, "request");

    await expect(
      requestPinnedProviderAddress(
        makeInput(override as Partial<ProviderNativeRequest>),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(httpsSpy).not.toHaveBeenCalled();
  });

  it("accepts only identity request and response encodings", async () => {
    const httpsSpy = vi.spyOn(https, "request");
    await expect(
      requestPinnedProviderAddress(
        makeInput({ headers: { "Accept-Encoding": "gzip" } }),
      ),
    ).rejects.toThrow("only accepts identity encoding");
    expect(httpsSpy).not.toHaveBeenCalled();

    const fixture = mockResponse({
      status: 200,
      headers: { "content-encoding": "br" },
      chunks: [],
    });
    vi.spyOn(https, "request").mockImplementationOnce(((
      _options: http.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      callback?.(fixture.response as never);
      return fixture.request as never;
    }) as unknown as typeof https.request);

    await expect(requestPinnedProviderAddress(makeInput())).rejects.toThrow(
      "non-identity Content-Encoding",
    );
    expect(fixture.response.destroy).toHaveBeenCalled();
    expect(fixture.request.destroy).toHaveBeenCalled();
  });

  it("accepts a response exactly at the raw byte cap", async () => {
    installHttpsResponse({
      status: 200,
      headers: { "content-length": "6", "content-encoding": "identity" },
      chunks: [Buffer.from("abc"), Buffer.from("def")],
    });

    await expect(
      requestPinnedProviderAddress(makeInput({ maxResponseBytes: 6 })),
    ).resolves.toMatchObject({ body: Buffer.from("abcdef") });
  });

  it("preserves every raw Location header without relying on collapsed headers", async () => {
    installHttpsResponse({
      status: 302,
      headers: { location: "https://one.example, https://two.example" },
      rawHeaders: [
        "Location",
        "https://one.example",
        "location",
        "https://two.example",
      ],
      chunks: [],
    });

    await expect(
      requestPinnedProviderAddress(makeInput()),
    ).resolves.toMatchObject({
      locationHeaders: ["https://one.example", "https://two.example"],
    });
  });

  it("rejects an over-limit Content-Length before buffering", async () => {
    const fixture = mockResponse({
      status: 200,
      headers: { "content-length": "7" },
      chunks: [],
    });
    installFixture(fixture);

    const rejection = requestPinnedProviderAddress(
      makeInput({ maxResponseBytes: 6 }),
    );
    await expect(rejection).rejects.toMatchObject({
      name: "ProviderResponseTooLargeError",
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      maxResponseBytes: 6,
      observedResponseBytes: 7,
    });
    expect(fixture.response.destroy).toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "not-a-number", "9007199254740992"])(
    "rejects invalid Content-Length %s",
    async (contentLength) => {
      installHttpsResponse({
        status: 200,
        headers: { "content-length": contentLength },
        chunks: [],
      });

      await expect(requestPinnedProviderAddress(makeInput())).rejects.toThrow(
        "invalid Content-Length",
      );
    },
  );

  it("rejects duplicate Content-Length values", async () => {
    installHttpsResponse({
      status: 200,
      headers: {
        "content-length": ["1", "1"],
      } as unknown as http.IncomingHttpHeaders,
      chunks: [],
    });

    await expect(requestPinnedProviderAddress(makeInput())).rejects.toThrow(
      "invalid Content-Length",
    );
  });

  it("counts chunked and multibyte responses by raw bytes", async () => {
    const fixture = mockResponse({
      status: 200,
      chunks: [Buffer.alloc(4), "€"],
    });
    installFixture(fixture);

    await expect(
      requestPinnedProviderAddress(makeInput({ maxResponseBytes: 6 })),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    expect(fixture.request.destroy).toHaveBeenCalled();
    expect(fixture.response.destroy).toHaveBeenCalled();
  });

  it("preserves the oversized error when a real chunked response is destroyed", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.write(Buffer.alloc(4));
      response.end(Buffer.alloc(4));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(
        requestPinnedProviderAddress(
          makeInput({
            url: new URL(`http://provider.test:${port}/chunked`),
            resolvedAddress: "127.0.0.1",
            maxResponseBytes: 6,
          }),
        ),
      ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("destroys an in-flight request when its signal aborts", async () => {
    const controller = new AbortController();
    const request = pendingRequest();
    vi.spyOn(https, "request").mockReturnValueOnce(request as never);

    const pending = requestPinnedProviderAddress(
      makeInput({ signal: controller.signal }),
    );
    const reason = new Error("cancelled by caller");
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(request.destroy).toHaveBeenCalledWith(reason);
  });

  it("rejects an already-aborted signal without opening a socket", async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi.spyOn(https, "request");

    await expect(
      requestPinnedProviderAddress(makeInput({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).not.toHaveBeenCalled();
  });
});

function makeInput(
  overrides: Partial<ProviderNativeRequest> = {},
): ProviderNativeRequest {
  return {
    url: new URL("https://models.example/v1/chat"),
    resolvedAddress: "93.184.216.34",
    method: "POST",
    headers: {},
    body: Buffer.from("body"),
    signal: new AbortController().signal,
    maxResponseBytes: 102_400,
    ...overrides,
  };
}

function installHttpsResponse(input: {
  status: number;
  headers?: http.IncomingHttpHeaders;
  rawHeaders?: string[];
  chunks: Array<string | Buffer>;
}): void {
  installFixture(mockResponse(input));
}

function installFixture(fixture: {
  request: MockRequest;
  response: MockResponse;
}): void {
  vi.spyOn(https, "request").mockImplementationOnce(((
    _options: http.RequestOptions,
    callback?: (response: http.IncomingMessage) => void,
  ) => {
    callback?.(fixture.response as never);
    return fixture.request as never;
  }) as unknown as typeof https.request);
}

function pendingRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.end = vi.fn();
  request.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => request.emit("error", error));
  });
  return request;
}

function mockResponse(input: {
  status: number;
  headers?: http.IncomingHttpHeaders;
  rawHeaders?: string[];
  chunks: Array<string | Buffer>;
}): { request: MockRequest; response: MockResponse } {
  const response = new EventEmitter() as MockResponse;
  response.statusCode = input.status;
  response.headers = input.headers ?? {};
  response.rawHeaders = input.rawHeaders ?? [];
  response.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => response.emit("error", error));
  });
  const request = pendingRequest();
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      for (const chunk of input.chunks) response.emit("data", chunk);
      response.emit("end");
    });
  });
  return { request, response };
}

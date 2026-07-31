import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";

import { requestProviderEndpoint } from "../../llm-egress-proxy/src/providerHttpClient";
import type {
  ProviderNativeRequest,
  ProviderNativeResponse,
} from "../../llm-egress-proxy/src/providerNativeTransport";

function response(
  status: number,
  headers: ProviderNativeResponse["headers"] = {},
  body = Buffer.alloc(0),
): ProviderNativeResponse {
  return {
    status,
    headers,
    body,
    locationHeaders:
      typeof headers.location === "string" ? [headers.location] : [],
  };
}

function sequenceTransport(...responses: ProviderNativeResponse[]) {
  return vi.fn<
    (input: ProviderNativeRequest) => Promise<ProviderNativeResponse>
  >(async () => responses.shift() ?? response(500));
}

const loopbackLookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);

async function withHttpServer<T>(
  listener: RequestListener,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("provider HTTP client", () => {
  afterEach(() => {
    delete process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS;
    delete process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pins a validated address and returns a bounded non-redirect response", async () => {
    const transport = sequenceTransport(
      response(200, { "content-type": "application/json" }, Buffer.from("{}")),
    );

    await expect(
      requestProviderEndpoint(
        {
          url: "http://localhost:11434/api/tags#ignored",
          headers: { "Accept-Encoding": "gzip", "X-Test": "present" },
          timeoutMs: 1000,
        },
        { lookup: loopbackLookup, transport },
      ),
    ).resolves.toMatchObject({
      status: 200,
      ok: true,
      url: new URL("http://localhost:11434/api/tags"),
      body: Buffer.from("{}"),
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL("http://localhost:11434/api/tags"),
        resolvedAddress: "127.0.0.1",
        method: "GET",
        headers: {
          "Accept-Encoding": "identity",
          "X-Test": "present",
        },
        maxResponseBytes: 1024 * 1024,
      }),
    );
  });

  it("rejects invalid deadlines and URLs without starting transport", async () => {
    const transport = sequenceTransport(response(200));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434", timeoutMs: 0 },
        { lookup: loopbackLookup, transport },
      ),
    ).rejects.toThrow("positive integer");
    await expect(
      requestProviderEndpoint(
        { url: "not a provider URL", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport },
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("bypasses DNS for numeric endpoints admitted by CIDR policy", async () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = "127.0.0.0/8";
    const lookup = vi.fn();
    const transport = sequenceTransport(response(204));

    await requestProviderEndpoint(
      { url: "http://127.0.0.1:11434", timeoutMs: 1000 },
      { lookup, transport },
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedAddress: "127.0.0.1" }),
    );
  });

  it.each([301, 302, 303])(
    "converts POST to GET across a %s redirect and drops entity headers",
    async (status) => {
      const transport = sequenceTransport(
        response(status, { location: "/next" }),
        response(200),
      );

      await requestProviderEndpoint(
        {
          url: "http://localhost:11434/start",
          method: "POST",
          headers: {
            Authorization: "Bearer secret",
            "Content-Type": "application/json",
            "Content-Length": "2",
            "Content-Encoding": "identity",
            Digest: "digest",
          },
          body: "{}",
          timeoutMs: 1000,
        },
        { lookup: loopbackLookup, transport },
      );

      expect(transport).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: new URL("http://localhost:11434/next"),
          method: "GET",
          headers: {
            "Accept-Encoding": "identity",
            Authorization: "Bearer secret",
          },
        }),
      );
      expect(transport.mock.calls[1]![0]).not.toHaveProperty("body");
    },
  );

  it("keeps HEAD on a 303 and preserves a request without a body", async () => {
    const transport = sequenceTransport(
      response(303, { location: "/next" }),
      response(200),
    );

    await requestProviderEndpoint(
      {
        url: "http://localhost:11434/start",
        method: "HEAD",
        timeoutMs: 1000,
      },
      { lookup: loopbackLookup, transport },
    );

    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it.each([307, 308])(
    "preserves method and bytes across a %s redirect",
    async (status) => {
      const transport = sequenceTransport(
        response(status, { location: "/next" }),
        response(200),
      );

      await requestProviderEndpoint(
        {
          url: "http://localhost:11434/start",
          method: "PUT",
          body: Buffer.from("payload"),
          timeoutMs: 1000,
        },
        { lookup: loopbackLookup, transport },
      );

      expect(transport).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          method: "PUT",
          body: Buffer.from("payload"),
        }),
      );
    },
  );

  it("permanently strips credentials after a cross-origin port change", async () => {
    const transport = sequenceTransport(
      response(307, { location: "http://localhost:11435/middle" }),
      response(307, { location: "http://localhost:11434/final" }),
      response(200),
    );

    await requestProviderEndpoint(
      {
        url: "http://localhost:11434/start",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
          "Proxy-Authorization": "proxy-secret",
          "X-Safe": "kept",
        },
        timeoutMs: 1000,
      },
      { lookup: loopbackLookup, transport },
    );

    for (const call of transport.mock.calls.slice(1)) {
      expect(call[0].headers).toEqual({
        "Accept-Encoding": "identity",
        "X-Safe": "kept",
      });
    }
  });

  it("rejects a denied redirect target before a second transport call", async () => {
    const transport = sequenceTransport(
      response(302, { location: "http://ollama:11434/private" }),
    );

    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport },
      ),
    ).rejects.toThrow("host_not_allowed");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects without Location and HTTPS downgrades", async () => {
    const missingLocation = sequenceTransport(response(302));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport: missingLocation },
      ),
    ).rejects.toThrow("missing a valid Location");

    process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS = "true";
    const downgrade = sequenceTransport(
      response(302, { location: "http://example.com/insecure" }),
    );
    await expect(
      requestProviderEndpoint(
        { url: "https://example.com/start", timeoutMs: 1000 },
        {
          lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
          transport: downgrade,
        },
      ),
    ).rejects.toThrow("cannot downgrade");
  });

  it("rejects ambiguous duplicate Location headers", async () => {
    const ambiguous: ProviderNativeResponse = {
      ...response(302, { location: "http://localhost:11434/one" }),
      locationHeaders: [
        "http://localhost:11434/one",
        "http://localhost:11434/two",
      ],
    };
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        {
          lookup: loopbackLookup,
          transport: sequenceTransport(ambiguous),
        },
      ),
    ).rejects.toThrow("valid Location");
  });

  it("rejects redirect loops and chains beyond the hard limit", async () => {
    const loop = sequenceTransport(response(307, { location: "/start" }));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport: loop },
      ),
    ).rejects.toThrow("loop");

    const chain = sequenceTransport(
      ...Array.from({ length: 6 }, (_, index) =>
        response(302, { location: `/hop-${index + 1}` }),
      ),
    );
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport: chain },
      ),
    ).rejects.toThrow("limit");
    expect(chain).toHaveBeenCalledTimes(6);
  });

  it("uses one deadline across DNS and transport work", async () => {
    vi.useFakeTimers();
    const lookup = vi.fn(
      () =>
        new Promise<Array<{ address: string; family: number }>>(() => {
          // Intentionally unresolved to prove the chain deadline owns DNS.
        }),
    );
    const request = requestProviderEndpoint(
      { url: "http://localhost:11434/start", timeoutMs: 25 },
      { lookup, transport: sequenceTransport(response(200)) },
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it("returns other 3xx statuses without following them", async () => {
    const transport = sequenceTransport(response(304));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup: loopbackLookup, transport },
      ),
    ).resolves.toMatchObject({ status: 304, ok: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("propagates resolver failures without attempting transport", async () => {
    const transport = sequenceTransport(response(200));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        {
          lookup: vi.fn(async () => {
            throw new Error("resolver failed");
          }),
          transport,
        },
      ),
    ).rejects.toThrow("resolver failed");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects the entire DNS set before transport when one answer is unsafe", async () => {
    const transport = sequenceTransport(response(200));
    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        {
          lookup: vi.fn(async () => [
            { address: "127.0.0.1", family: 4 },
            { address: "93.184.216.34", family: 4 },
          ]),
          transport,
        },
      ),
    ).rejects.toThrow("resolved_address_not_allowed");
    expect(transport).not.toHaveBeenCalled();
  });

  it("resolves every hop again and rejects second-hop rebinding", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const transport = sequenceTransport(
      response(307, { location: "/rebound" }),
      response(200),
    );

    await expect(
      requestProviderEndpoint(
        { url: "http://localhost:11434/start", timeoutMs: 1000 },
        { lookup, transport },
      ),
    ).rejects.toThrow("resolved_address_not_allowed");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses the default resolver when no lookup dependency is supplied", async () => {
    const transport = sequenceTransport(response(200));
    await requestProviderEndpoint(
      { url: "http://localhost:11434/start", timeoutMs: 1000 },
      { transport },
    );
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedAddress: expect.stringMatching(/^(127\.0\.0\.1|::1)$/),
      }),
    );
  });

  it("follows a relative redirect through the real pinned transport", async () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = "127.0.0.0/8";
    await withHttpServer(
      (request, responseStream) => {
        if (request.url === "/start") {
          responseStream.writeHead(302, { Location: "/final" });
          responseStream.end();
          return;
        }
        responseStream.end("bounded");
      },
      async (baseUrl) => {
        await expect(
          requestProviderEndpoint({
            url: new URL("/start#ignored", baseUrl),
            timeoutMs: 1000,
          }),
        ).resolves.toMatchObject({
          status: 200,
          ok: true,
          url: new URL("/final", baseUrl),
          body: Buffer.from("bounded"),
        });
      },
    );
  });

  it("validates an absolute cross-port redirect before preserving its body", async () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = "127.0.0.0/8";
    let receivedAuthorization: string | undefined;
    let receivedBody = "";
    await withHttpServer(
      (request, responseStream) => {
        receivedAuthorization = request.headers.authorization;
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          receivedBody += chunk;
        });
        request.on("end", () => responseStream.end("accepted"));
      },
      async (destinationUrl) => {
        await withHttpServer(
          (_request, responseStream) => {
            responseStream.writeHead(307, {
              Location: `${destinationUrl}/accepted`,
            });
            responseStream.end();
          },
          async (sourceUrl) => {
            await expect(
              requestProviderEndpoint({
                url: `${sourceUrl}/start`,
                method: "POST",
                headers: {
                  Authorization: "Bearer must-not-cross-origins",
                  "Content-Type": "text/plain",
                },
                body: "preserved payload",
                timeoutMs: 1000,
              }),
            ).resolves.toMatchObject({
              status: 200,
              url: new URL("/accepted", destinationUrl),
            });
          },
        );
      },
    );
    expect(receivedAuthorization).toBeUndefined();
    expect(receivedBody).toBe("preserved payload");
  });

  it("enforces the shared raw-byte cap through the real transport", async () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = "127.0.0.0/8";
    await withHttpServer(
      (_request, responseStream) => {
        responseStream.end(Buffer.alloc(1024 * 1024 + 1));
      },
      async (baseUrl) => {
        await expect(
          requestProviderEndpoint({ url: baseUrl, timeoutMs: 1000 }),
        ).rejects.toMatchObject({ name: "ProviderResponseTooLargeError" });
      },
    );
  });
});

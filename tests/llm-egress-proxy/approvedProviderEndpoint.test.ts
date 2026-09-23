import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectProviderModels: vi.fn(),
}));

vi.mock("../../llm-egress-proxy/src/providerDetection", () => ({
  detectProviderModels: mocks.detectProviderModels,
}));

vi.mock("../../llm-egress-proxy/src/providerModels", () => ({
  listOllamaModels: vi.fn(),
  listProviderModels: vi.fn(),
}));

import { registerConfigRoutes } from "../../llm-egress-proxy/src/configRoutes";
import {
  evaluateProviderEndpoint,
  setConfiguredProviderEndpoint,
  validateProviderResolvedAddresses,
  withApprovedProviderEndpoint,
} from "../../llm-egress-proxy/src/endpointPolicy";
import { registerProviderRoutes } from "../../llm-egress-proxy/src/providerRoutes";

function makeApp() {
  const routes = {
    delete: new Map<string, Function>(),
    get: new Map<string, Function>(),
    post: new Map<string, Function>(),
  };
  const register =
    (map: Map<string, Function>) =>
    (path: string, ...handlers: Function[]) =>
      map.set(path, handlers.at(-1)!);
  return {
    app: {
      delete: register(routes.delete),
      get: register(routes.get),
      post: register(routes.post),
    },
    routes,
  };
}

function makeResponse() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

/** Drives POST /config the way the backend's settings sync does. */
function configure(endpoint: string) {
  const { app, routes } = makeApp();
  let aiConfig = {
    enabled: true,
    endpoint: "",
    model: "llama3.2",
    providerProfileId: "local",
    providerType: "ollama",
    apiKey: "",
  };
  registerConfigRoutes(app as any, {
    getAiConfig: () => aiConfig,
    updateAiConfig: (update: Partial<typeof aiConfig>) => {
      aiConfig = { ...aiConfig, ...update };
      return aiConfig;
    },
    log,
  } as any);
  const res = makeResponse();
  routes.post.get("/config")!({ body: { endpoint } }, res);
  return res;
}

const ipv4 = (address: string) => [{ address, family: 4 as const }];

describe("admin-configured LAN provider endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setConfiguredProviderEndpoint("");
    delete process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS;
    delete process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS;
  });

  it("accepts a numeric LAN endpoint saved in the UI without an env allowlist", () => {
    // Non-regression: this was rejected with host_not_allowed unless the
    // operator also added the range to LLM_EGRESS_PROXY_ALLOWED_CIDRS.
    const res = configure("http://192.168.1.20:11434");

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const decision = evaluateProviderEndpoint("http://192.168.1.20:11434");
    expect(decision).toMatchObject({
      allowed: true,
      resolvedAddressPolicy: { mode: "approved-lan" },
    });
    expect(validateProviderResolvedAddresses(ipv4("192.168.1.20"), decision)).toEqual(
      ipv4("192.168.1.20"),
    );
  });

  it("follows the setting: changing the endpoint revokes the previous address", () => {
    configure("http://192.168.1.20:11434");
    configure("http://192.168.1.30:11434");

    expect(evaluateProviderEndpoint("http://192.168.1.30:11434").allowed).toBe(true);
    expect(evaluateProviderEndpoint("http://192.168.1.20:11434")).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
  });

  it("admits only the configured host, so a provider cannot redirect into the LAN", () => {
    configure("http://192.168.1.20:11434");

    // Every redirect hop is evaluated on its own URL.
    expect(evaluateProviderEndpoint("http://192.168.1.21:11434").allowed).toBe(false);
    expect(evaluateProviderEndpoint("http://10.0.0.5:6379").allowed).toBe(false);
  });

  it.each([
    ["cloud metadata", "http://169.254.169.254/latest"],
    ["loopback inside the proxy container", "http://127.0.0.1:11434"],
    ["a public address over plain HTTP", "http://203.0.113.10:11434"],
  ])("still refuses %s even when an admin saves it", (_label, endpoint) => {
    const res = configure(endpoint);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(evaluateProviderEndpoint(endpoint).allowed).toBe(false);
  });

  it("accepts an IPv6 unique-local endpoint", () => {
    configure("http://[fd12:3456::5]:11434");

    const decision = evaluateProviderEndpoint("http://[fd12:3456::5]:11434");
    expect(decision.allowed).toBe(true);
    expect(
      validateProviderResolvedAddresses([{ address: "fd12:3456::5", family: 6 }], decision),
    ).toHaveLength(1);
  });

  it.each([
    // A name is re-resolved on every hop, so approving it would let whoever
    // controls its DNS move the proxy across the LAN; single-label names are
    // Docker services (backend, postgres, redis). Names keep the existing
    // routes: *.local, host.docker.internal, or the env allowlists.
    ["a LAN hostname", "http://gpu-box.lan:11434"],
    ["a Docker service name", "http://postgres:5432"],
  ])("does not approve %s", (_label, endpoint) => {
    const res = configure(endpoint);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(evaluateProviderEndpoint(endpoint).allowed).toBe(false);
  });

  it("approves the saved port only, so a provider cannot redirect to another service on the host", () => {
    configure("http://192.168.1.20:11434");

    expect(evaluateProviderEndpoint("http://192.168.1.20:11434/api/chat").allowed).toBe(true);
    expect(evaluateProviderEndpoint("http://192.168.1.20:22").allowed).toBe(false);
    expect(evaluateProviderEndpoint("http://192.168.1.20/").allowed).toBe(false);
  });

  it("treats a default port and its explicit form as the same endpoint", () => {
    configure("http://192.168.1.20/v1");

    expect(evaluateProviderEndpoint("http://192.168.1.20:80/v1/models").allowed).toBe(true);
    expect(evaluateProviderEndpoint("https://192.168.1.20/v1").allowed).toBe(false);
  });

  it("matches other spellings of the approved address, and no other address", () => {
    configure("http://192.168.1.20:11434");

    for (const spelling of [
      "http://3232235796:11434",
      "http://0300.0250.1.20:11434",
      "http://[::ffff:192.168.1.20]:11434",
    ]) {
      expect(evaluateProviderEndpoint(spelling).allowed).toBe(true);
    }
    expect(evaluateProviderEndpoint("http://[::ffff:192.168.1.21]:11434").allowed).toBe(false);
  });

  it("clears the approval when the endpoint is emptied", () => {
    configure("http://192.168.1.20:11434");
    configure("");

    expect(evaluateProviderEndpoint("http://192.168.1.20:11434").allowed).toBe(false);
  });

  it("keeps concurrent detection approvals apart", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => (releaseFirst = resolve));

    const first = withApprovedProviderEndpoint("http://192.168.1.51:11434", async () => {
      await firstGate;
      return evaluateProviderEndpoint("http://192.168.1.52:11434").allowed;
    });
    const second = withApprovedProviderEndpoint("http://192.168.1.52:11434", async () => {
      const own = evaluateProviderEndpoint("http://192.168.1.52:11434").allowed;
      const other = evaluateProviderEndpoint("http://192.168.1.51:11434").allowed;
      releaseFirst();
      return { own, other };
    });

    expect(await second).toEqual({ own: true, other: false });
    expect(await first).toBe(false);
  });

  it("leaves hosts the existing rules already allow on their own policy", () => {
    process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS = "true";
    configure("https://api.provider.example");

    expect(evaluateProviderEndpoint("https://api.provider.example")).toMatchObject({
      allowed: true,
      resolvedAddressPolicy: { mode: "public-https" },
    });

    configure("http://host.docker.internal:11434");
    expect(evaluateProviderEndpoint("http://host.docker.internal:11434")).toMatchObject({
      resolvedAddressPolicy: { mode: "local-network" },
    });
  });

  it("keeps an operator CIDR allowlist working alongside the configured endpoint", () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = "10.0.0.0/8";
    configure("http://192.168.1.20:11434");

    expect(evaluateProviderEndpoint("http://10.1.2.3:11434")).toMatchObject({
      allowed: true,
      resolvedAddressPolicy: { mode: "explicit-cidr" },
    });
  });

  it("keeps the configured endpoint when an update does not name one", () => {
    configure("http://192.168.1.20:11434");
    const { app, routes } = makeApp();
    let aiConfig = { enabled: true, endpoint: "http://192.168.1.20:11434" };
    registerConfigRoutes(app as any, {
      getAiConfig: () => aiConfig,
      updateAiConfig: (update: Partial<typeof aiConfig>) => (aiConfig = { ...aiConfig, ...update }),
      log,
    } as any);

    routes.post.get("/config")!({ body: { enabled: false } }, makeResponse());

    expect(evaluateProviderEndpoint("http://192.168.1.20:11434").allowed).toBe(true);
  });

  it("scopes a request approval to that request only", async () => {
    configure("http://192.168.1.20:11434");

    const inside = await withApprovedProviderEndpoint("http://192.168.1.50:1234/v1", async () => {
      await Promise.resolve();
      return {
        typed: evaluateProviderEndpoint("http://192.168.1.50:1234/v1").allowed,
        configured: evaluateProviderEndpoint("http://192.168.1.20:11434").allowed,
      };
    });

    expect(inside).toEqual({ typed: true, configured: true });
    expect(evaluateProviderEndpoint("http://192.168.1.50:1234/v1").allowed).toBe(false);
  });

  it("lets the admin detect-provider route probe a typed LAN endpoint before it is saved", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, {
      backendUrl: "http://backend:3001",
      getAiConfig: () => ({ enabled: true, endpoint: "", model: "", providerType: "ollama" }),
      log,
    } as any);
    let allowedDuringDetection: boolean | undefined;
    mocks.detectProviderModels.mockImplementationOnce(async (_config, endpoint: string) => {
      allowedDuringDetection = evaluateProviderEndpoint(endpoint).allowed;
      return { found: true, endpoint, models: ["llama3.2"] };
    });

    const res = makeResponse();
    await routes.post.get("/detect-provider")!(
      { body: { endpoint: "http://192.168.1.60:11434" } },
      res,
    );

    expect(allowedDuringDetection).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
    // Detection alone does not change what the proxy will call later.
    expect(evaluateProviderEndpoint("http://192.168.1.60:11434").allowed).toBe(false);
  });

  it("ignores endpoints it cannot parse", () => {
    setConfiguredProviderEndpoint("not a url");
    expect(evaluateProviderEndpoint("http://192.168.1.20:11434").allowed).toBe(false);
  });
});

import { validateBrowserSandboxEvidence, formatBrowserError, createBrowserErrorRedactor } from "../../scripts/lib/browser-sandbox-contract.mjs";
import { describe, expect, it, vi } from "vitest";
import { verifyServer } from "../../scripts/ci/browser-server.mjs";

const diagnostics = [
  "Sandbox Status",
  "Layer 1 Sandbox Namespace",
  "PID namespaces Yes",
  "Network namespaces Yes",
  "Seccomp-BPF sandbox Yes"
].join("\n");

function browserFixture({ renderer = true } = {}) {
  const order: string[] = [];
  const page = {
    goto: vi.fn(async () => { order.push("goto"); }),
    locator: vi.fn(() => ({ innerText: vi.fn(async () => diagnostics) })),
    setContent: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.alloc(128)),
    close: vi.fn(async () => {})
  };
  const cdp = {
    send: vi.fn(async (method: string) => {
      if (method === "Browser.getBrowserCommandLine") return { arguments: ["--enable-automation"] };
      if (method === "SystemInfo.getProcessInfo") {
        order.push("process-info");
        if (!order.includes("goto")) throw new Error("renderer queried before a live page existed");
        return { processInfo: renderer ? [{ type: "browser", id: 1 }, { type: "renderer", id: 2 }] : [{ type: "browser", id: 1 }] };
      }
      throw new Error(`unexpected CDP method ${method}`);
    }),
    detach: vi.fn(async () => {})
  };
  const browser = {
    newBrowserCDPSession: vi.fn(async () => cdp),
    newPage: vi.fn(async () => page),
    version: vi.fn(() => "157.0.8103.38"),
    close: vi.fn(async () => {})
  };
  const chromium = { connect: vi.fn(async () => browser) };
  const server = { wsEndpoint: vi.fn(() => "ws://127.0.0.1:3000/token") };
  return { order, page, cdp, browser, chromium, server };
}

describe("sandboxed browser server bootstrap", () => {
  it("waits for a live renderer and verifies the strict sandbox contract before readiness", async () => {
    const fixture = browserFixture();
    const evidence = await verifyServer(fixture.chromium, fixture.server, {
      uid: 1000,
      browserVersion: "157.0.8103.38",
      capabilityMasks: { CapBnd: "0000000000000000", CapEff: "0000000000000000", CapPrm: "0000000000000000", CapInh: "0000000000000000", CapAmb: "0000000000000000" },
      noNewPrivs: 1
    });
    expect(fixture.order).toEqual(["goto", "goto", "process-info"]);
    expect(evidence).toMatchObject({ browserVersion: "157.0.8103.38", rendererCount: 1 });
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it("rejects readiness when Chromium has no renderer process", async () => {
    const fixture = browserFixture({ renderer: false });
    await expect(verifyServer(fixture.chromium, fixture.server, { uid: 1000, browserVersion: "157.0.8103.38" })).rejects.toThrow(/contains no renderer/);
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });
});


describe("browser endpoint error redaction", () => {
  const token = "secret-browser-token-0123456789";
  const callLog = `browserType.connect: WebSocket error: connect ECONNREFUSED\nCall log:\n  - <ws connecting> ws://127.0.0.1:42731/${token}\n  - <ws error> ws://127.0.0.1:42731/${token} failed`;

  it("preserves useful Playwright error context while removing tokens from messages and stacks", () => {
    const error = new Error(callLog);
    for (const output of [formatBrowserError(error), formatBrowserError(error, { stack: true }), formatBrowserError(callLog)]) {
      expect(output).toContain("ECONNREFUSED");
      expect(output).toContain("[redacted-browser-endpoint]");
      expect(output).not.toContain(token);
      expect(output).not.toContain("ws://127.0.0.1:42731/");
    }
    expect(formatBrowserError("ordinary diagnostic")).toBe("ordinary diagnostic");
  });

  it("redacts endpoints split across arbitrary stderr chunks and flushes the trailing line", () => {
    for (let split = 0; split <= callLog.length; split += 1) {
      const output: string[] = [];
      const redactor = createBrowserErrorRedactor(text => output.push(text));
      redactor.write(callLog.slice(0, split));
      redactor.write(callLog.slice(split));
      redactor.flush();
      expect(output.join("")).toContain("ECONNREFUSED");
      expect(output.join("")).not.toContain(token);
      expect(output.join("")).not.toContain("ws://127.0.0.1:");
    }
  });

  it("bounds pending diagnostic lines and resumes cleanly at the next newline", () => {
    const output: string[] = [];
    const redactor = createBrowserErrorRedactor(text => output.push(text));
    redactor.write("x".repeat(65_537));
    redactor.write(`ws://127.0.0.1:42731/${token}\nnormal\n`);
    redactor.flush();
    expect(output.join("")).toBe("[browser diagnostic line truncated]\nnormal\n");
  });
});


describe("mandatory sandbox evidence rejection", () => {
  const valid = () => ({
    diagnosticsText: diagnostics,
    browserFlags: ["--enable-automation"],
    processInfo: { processInfo: [{ type: "renderer", id: 2 }] },
    effectiveUid: 1000,
  });

  it("accepts complete evidence including Chromium's separate TSYNC status row", () => {
    expect(validateBrowserSandboxEvidence({ ...valid(), diagnosticsText: `${diagnostics}\nSeccomp-BPF sandbox supports TSYNC Yes` })).toEqual({ ok: true, errors: [] });
  });

  it.each([
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-namespace-sandbox",
    "--disable-renderer-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox",
  ])("rejects disabling flag %s, including a value-bearing spelling", (flag) => {
    for (const spelling of [flag, `${flag}=true`]) {
      const result = validateBrowserSandboxEvidence({ ...valid(), browserFlags: ["--enable-automation", spelling] });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(`sandbox disabling flags present: ${spelling}`);
    }
  });

  it.each([0, -1, 1.5, undefined, null, "1000"])("rejects root or invalid UID %s", (effectiveUid) => {
    const result = validateBrowserSandboxEvidence({ ...valid(), effectiveUid });
    expect(result.ok).toBe(false);
    expect(result.errors.join(";")).toMatch(/root|UID is missing or invalid/);
  });

  it.each(["PID namespaces", "Network namespaces", "Seccomp-BPF sandbox"])("rejects inactive, missing and duplicated %s rows", (layer) => {
    for (const diagnosticsText of [
      diagnostics.replace(`${layer} Yes`, `${layer} No`),
      diagnostics.replace(`${layer} Yes`, `${layer} Unknown`),
      diagnostics.replace(`${layer} Yes`, ""),
      `${diagnostics}\n${layer} Yes`,
      `${diagnostics}\n${layer} No`,
    ]) {
      const result = validateBrowserSandboxEvidence({ ...valid(), diagnosticsText });
      expect(result.ok).toBe(false);
      expect(result.errors.join(";")).toContain(layer);
    }
  });

  it.each(["Layer 1 Sandbox None", "Layer 1 Sandbox SUID", "Layer 1 Sandbox Namespace\nLayer 1 Sandbox Namespace"])("rejects invalid layer-one evidence: %s", (row) => {
    const result = validateBrowserSandboxEvidence({ ...valid(), diagnosticsText: diagnostics.replace("Layer 1 Sandbox Namespace", row) });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Layer 1 sandbox mode must be explicitly Namespace exactly once");
  });

  it("rejects missing evidence, invalid flags and missing live renderer evidence", () => {
    for (const evidence of [undefined, null, {},
      { ...valid(), browserFlags: [] }, { ...valid(), browserFlags: [42] },
      { ...valid(), browserFlags: ["--headless"] },
      { ...valid(), diagnosticsText: "" }, { ...valid(), diagnosticsText: "unrecognized page" },
      { ...valid(), processInfo: null }, { ...valid(), processInfo: { processInfo: [{ type: "renderer", id: 0 }] } },
    ]) expect(validateBrowserSandboxEvidence(evidence).ok).toBe(false);
  });
});

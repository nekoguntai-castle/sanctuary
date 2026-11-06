import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBrowserChild,
  assertOuterContainer,
  createBrowserPayload,
  engineSocketFromEnv,
  parseCommand,
  resolveOuterHostname,
  runSandboxedPlaywright
} from "../../scripts/ci/run-sandboxed-playwright.mjs";
import { assertSeccompBrowserContainer, createSeccompBrowserPayload } from "../../scripts/ci/lib/browser-container-security.mjs";
import { browserContainerOwnershipLabels } from "../../scripts/ci/lib/browser-container-ownership.mjs";

const PROFILE_HASH = "97fa67ad55ffa98b8fd918b8cd8693e8f5c2a409962318d9d02e33c72b58f363";
const PROFILE = `/etc/forgejo-runner/browser-seccomp/${PROFILE_HASH}.json`;
const OUTER_ID = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const CHILD_ID = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const IMAGE = "nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright:pw1.64.1-chrome157.0.8103.38-sandbox1@sha256:cf627d37888e1ba12e70a73457fb1a226bd24b6a722892af17752b0c9a09a443";
const OWNERSHIP = {
  project: "sanctuary-ci", deploymentId: "run-deployment", ownerId: "runner-owner",
  operationRunId: "run-browser", createdAt: "2026-11-04T00:00:00.000Z",
  createdByRelease: "unreleased", createdByCommit: "a".repeat(40),
  engineEndpoint: "unix:///var/run/docker.sock",
  checkoutRoot: "/repo", runtimeDirectory: "/tmp/sanctuary-runtime",
  ownershipRoot: "/tmp/sanctuary-runtime/ownership", statePath: "/tmp/sanctuary-runtime/coordinator-state.json",
  lifecycle: "obsolete" as const, cleanupPolicy: "exact_delete" as const
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

function childInspect(overrides: Record<string, unknown> = {}) {
  return {
    Image: IMAGE_ID,
    Config: { User: "1000:1000" },
    Mounts: [],
    HostConfig: {
      NetworkMode: `container:${OUTER_ID}`,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges", `seccomp=${PROFILE}`],
      Memory: 4_294_967_296,
      NanoCpus: 2_000_000_000,
      PidsLimit: 512,
      ShmSize: 536_870_912,
      Binds: [],
      Mounts: []
    },
    ...overrides
  };
}

function browserInspect(name: string) {
  const labels: Record<string, string> = {
    ...browserContainerOwnershipLabels(OWNERSHIP),
    "com.example.sanctuary.sandboxed-playwright": "v1",
    "com.example.sanctuary.run-id": name.replace("sanctuary-browser-", "")
  };
  return {
    Id: CHILD_ID,
    Name: `/${name}`,
    ...childInspect(),
    Config: { User: "1000:1000", Labels: labels }
  };
}

function imageInspect() {
  return {
    Id: IMAGE_ID,
    RepoDigests: ["nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright@sha256:cf627d37888e1ba12e70a73457fb1a226bd24b6a722892af17752b0c9a09a443"],
    Config: {
      User: "1000:1000",
      Env: [
        "PLAYWRIGHT_VERSION=1.64.1", "CHROME_VERSION=157.0.8103.38", "SANDBOX_POLICY_REVISION=1",
        "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/chrome/chrome-linux64/chrome", "PATH=/usr/local/bin:/usr/bin",
        "HOME=/home/pwuser", "PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers"
      ]
    }
  };
}

async function runWithFakeEngine({ failTest = false, failCleanup = false, retainAfterRemove = false, failRegistration = false, failCreateResponse = false, tamperOwnership = false, unexpectedServerExit = false, includeHostname = true, envHostname = OUTER_ID.slice(0, 12), kernelHost = OUTER_ID.slice(0, 12), ownershipEndpoint = OWNERSHIP.engineEndpoint } = {}) {
  const output = await mkdtemp(path.join(os.tmpdir(), "sandboxed-playwright-test-"));
  temporaryDirectories.push(output);
  const env = { NODE_ENV: "test", DOCKER_HOST: "unix:///var/run/docker.sock", ...(includeHostname ? { HOSTNAME: envHostname } : {}), SANCTUARY_E2E_OUTPUT_DIR: output } as NodeJS.ProcessEnv;
  const commands: string[][] = [];
  const registered: string[] = [];
  let removed = false;
  let containerName = "";
  let finishAttach: (code: number) => void = () => {};
  const command = async (_socket: string, args: string[]) => {
    commands.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([imageInspect()]), stderr: "" };
    if (args[0] === "inspect" && args[1] === kernelHost) {
      return { stdout: JSON.stringify([{ Id: OUTER_ID, Config: { Hostname: kernelHost }, State: { Running: true }, HostConfig: { NetworkMode: "bridge" } }]), stderr: "" };
    }
    if (args[0] === "inspect" && args[1] === CHILD_ID) return { stdout: JSON.stringify([browserInspect(containerName)]), stderr: "" };
    if (args[0] === "stop") finishAttach(0);
    if (args[0] === "rm" && !failCleanup && !retainAfterRemove) removed = true;
    if (args[0] === "rm" && failCleanup) throw new Error("injected remove failure");
    return { stdout: "", stderr: "" };
  };
  const api = async (_socket: string, method: string, endpoint: string) => {
    if (method === "POST") {
      if (failCreateResponse) throw new Error("injected create response failure");
      containerName = new URL(`http://engine${endpoint}`).searchParams.get("name") ?? "";
      return { Id: CHILD_ID };
    }
    if (method === "GET") {
      if (removed) throw new Error("engine API GET returned 404");
      const requestedId = endpoint.split("/containers/")[1]?.split("/json")[0];
      if (requestedId?.startsWith("sanctuary-browser-")) containerName = requestedId;
      const result = browserInspect(containerName);
      if (tamperOwnership && registered.length > 0) {
        result.Config.Labels["io.sanctuary.owner-id"] = "someone-else";
      }
      return result;
    }
    throw new Error(`unexpected API method ${method}`);
  };
  const attach = (_socket: string, _id: string, onReady: (endpoint: string) => void) => {
    onReady("ws://127.0.0.1:42731/abcdefghijk");
    return new Promise<number>(resolve => {
      finishAttach = resolve;
      if (unexpectedServerExit) setTimeout(() => resolve(17), 10);
    });
  };
  const runTest = async (_args: string[], endpoint: string) => {
    expect(endpoint).toBe("ws://127.0.0.1:42731/abcdefghijk");
    if (failTest) throw new Error("injected test command failure");
    if (unexpectedServerExit) await new Promise(resolve => setTimeout(resolve, 50));
    return { code: 0, signal: null };
  };
  const promise = runSandboxedPlaywright(["node", "test-command.mjs"], {
    env, command, api, attach, runTest, kernelHostname: () => kernelHost,
    ownershipLoader: () => ({ ...OWNERSHIP, engineEndpoint: ownershipEndpoint }),
    registerContainer: (_ownership: unknown, id: string) => {
      if (failRegistration) throw new Error("injected registration failure");
      registered.push(id);
    }
  });
  promise.then(() => {}, () => {});
  const getContainerName = () => containerName;
  return { promise, commands, output, registered, getContainerName, setContainerName: (value: string) => { containerName = value; } };
}

describe("sandboxed Playwright runner", () => {
  it("requires a local engine socket and an explicit generic command", () => {
    expect(engineSocketFromEnv({ NODE_ENV: "test", DOCKER_HOST: "unix:///run/podman/podman.sock" } as NodeJS.ProcessEnv)).toBe("/run/podman/podman.sock");
    expect(() => engineSocketFromEnv({ NODE_ENV: "test", DOCKER_HOST: "tcp://engine:2375" } as NodeJS.ProcessEnv)).toThrow(/Unix socket/);
    expect(parseCommand(["--", "npm", "test", "--", "one"])).toEqual(["npm", "test", "--", "one"]);
    expect(() => parseCommand(["npm", "test"])).toThrow(/usage/);
  });

  it("refuses a browser socket that differs from the coordinator-resolved Docker context before engine access", async () => {
    const mismatch = await runWithFakeEngine({ ownershipEndpoint: "unix:///run/other-engine.sock" });
    await expect(mismatch.promise).rejects.toThrow(/does not match the coordinator-resolved Docker context/);
    expect(mismatch.commands).toEqual([]);
  });

  it("uses the kernel hostname when HOSTNAME is absent and rejects conflicting identity", async () => {
    expect(resolveOuterHostname(undefined, OUTER_ID.slice(0, 12))).toBe(OUTER_ID.slice(0, 12));
    expect(() => resolveOuterHostname(undefined, "not-a-container-id")).toThrow(/kernel hostname/);
    expect(() => resolveOuterHostname(OUTER_ID.slice(0, 12), "fedcba987654")).toThrow(/does not match/);

    const fallback = await runWithFakeEngine({ includeHostname: false });
    await expect(fallback.promise).resolves.toMatchObject({ ok: true, exitCode: 0 });
    expect(fallback.commands[0]).toEqual(["inspect", OUTER_ID.slice(0, 12)]);

    const mismatch = await runWithFakeEngine({ envHostname: "fedcba987654" });
    await expect(mismatch.promise).rejects.toThrow(/does not match the kernel hostname/);
    expect(mismatch.commands).toEqual([]);
  });

  it("builds only the pinned no-mount child policy and rejects caller-selected images", () => {
    const payload = createBrowserPayload({ image: IMAGE, profile: PROFILE, profileHash: PROFILE_HASH, networkContainerId: OUTER_ID, runId: "12345678-1234-1234-1234-123456789abc", env: [], ownership: OWNERSHIP });
    expect(payload.Image).toBe(IMAGE);
    expect(payload.User).toBe("1000:1000");
    expect(payload.HostConfig).toMatchObject({
      NetworkMode: `container:${OUTER_ID}`,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges", `seccomp=${PROFILE}`],
      Memory: 4_294_967_296
    });
    expect(payload.HostConfig).not.toHaveProperty("Binds");
    expect(payload.HostConfig).not.toHaveProperty("Mounts");
    expect(payload.Labels).toMatchObject(browserContainerOwnershipLabels(OWNERSHIP));
    // @ts-expect-error Exercise runtime rejection of a missing ownership authority.
    expect(() => createBrowserPayload({ image: IMAGE, profile: PROFILE, profileHash: PROFILE_HASH, networkContainerId: OUTER_ID, runId: "12345678-1234-1234-1234-123456789abc", env: [] })).toThrow(/ownership authority/);
    expect(() => createBrowserPayload({ image: "other@sha256:abc", profile: PROFILE, profileHash: PROFILE_HASH, networkContainerId: OUTER_ID, runId: "12345678-1234-1234-1234-123456789abc", env: [], ownership: OWNERSHIP })).toThrow(/immutable Sanctuary/);
    expect(() => createBrowserPayload({ profile: "/tmp/relaxed.json", profileHash: PROFILE_HASH, networkContainerId: OUTER_ID, runId: "12345678-1234-1234-1234-123456789abc", env: [], ownership: OWNERSHIP })).toThrow(/hash-named/);
  });

  it("supports only the explicit local-image readonly probe contract", () => {
    const tmpfs = { "/tmp": "rw,nosuid,nodev,size=536870912,mode=1777" };
    const payload = createSeccompBrowserPayload({
      image: IMAGE_ID,
      allowImageId: true,
      user: "12345:12345",
      command: ["node", "verify.mjs"],
      profile: PROFILE,
      networkMode: "none",
      labels: { purpose: "local-runtime-probe" },
      readonlyRootfs: true,
      tmpfs
    });
    expect(payload).toMatchObject({ Image: IMAGE_ID, User: "12345:12345", HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Tmpfs: tmpfs } });
    const inspect = {
      Image: IMAGE_ID.slice("sha256:".length),
      Config: { User: "12345:12345" },
      Mounts: [{ Type: "tmpfs", Destination: "/tmp", RW: true }],
      HostConfig: {
        ...payload.HostConfig,
        CapDrop: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "NET_BIND_SERVICE", "SETFCAP", "SETGID", "SETPCAP", "SETUID", "SYS_CHROOT"]
      }
    };
    expect(() => assertSeccompBrowserContainer(inspect, { imageId: IMAGE_ID, user: "12345:12345", profile: PROFILE, networkMode: "none", readonlyRootfs: true, tmpfs })).not.toThrow();
    expect(() => assertSeccompBrowserContainer({ ...inspect, Mounts: [{ Type: "bind", Destination: "/var/run/docker.sock", RW: true }] }, { imageId: IMAGE_ID, user: "12345:12345", profile: PROFILE, networkMode: "none", readonlyRootfs: true, tmpfs })).toThrow(/no-mount/);
    expect(() => assertSeccompBrowserContainer({ ...inspect, HostConfig: { ...inspect.HostConfig, SecurityOpt: ["no-new-privileges", "seccomp=unconfined", `seccomp=${PROFILE}`] } }, { imageId: IMAGE_ID, user: "12345:12345", profile: PROFILE, networkMode: "none", readonlyRootfs: true, tmpfs })).toThrow(/seccomp policy/);
    expect(() => createSeccompBrowserPayload({ image: IMAGE_ID, user: "12345:12345", command: ["node"], profile: PROFILE, networkMode: "none", readonlyRootfs: true, tmpfs: { "/tmp": "/host/tmp" }, allowImageId: true })).toThrow(/reviewed writable \/tmp/);
  });

  it("binds the child network only to the verified running outer container", () => {
    const outer = { Id: OUTER_ID, Config: { Hostname: OUTER_ID.slice(0, 12) }, State: { Running: true }, HostConfig: { NetworkMode: "bridge" } };
    expect(assertOuterContainer(outer, OUTER_ID.slice(0, 12))).toBe(OUTER_ID);
    expect(() => assertOuterContainer({ ...outer, Config: { Hostname: "someone-else" } }, OUTER_ID.slice(0, 12))).toThrow(/HOSTNAME/);
    expect(() => assertOuterContainer({ ...outer, State: { Running: false } }, OUTER_ID.slice(0, 12))).toThrow(/HOSTNAME/);
    expect(() => assertBrowserChild(childInspect(), { profile: PROFILE, outerId: OUTER_ID, imageId: IMAGE_ID })).not.toThrow();
    expect(() => assertBrowserChild(childInspect({ Mounts: [{ Source: "/var/run/docker.sock" }] }), { profile: PROFILE, outerId: OUTER_ID, imageId: IMAGE_ID })).toThrow(/no-mount/);
    expect(() => assertBrowserChild(childInspect({ HostConfig: { ...childInspect().HostConfig, NetworkMode: "host" } }), { profile: PROFILE, outerId: OUTER_ID, imageId: IMAGE_ID })).toThrow(/no-mount/);
  });

  it("runs a generic command and removes its owned child after artifact retrieval", async () => {
    const { promise, commands, output, registered } = await runWithFakeEngine();
    const report = await promise;
    expect(report).toMatchObject({ ok: true, exitCode: 0, endpoint: "127.0.0.1:<dynamic> (token redacted)" });
    expect(JSON.stringify(report)).not.toContain("abcdefghijk");
    expect(commands.map(command => command[0])).toContain("stop");
    expect(commands.at(-1)).toEqual(["rm", "--force", CHILD_ID]);
    expect(registered).toEqual([CHILD_ID]);
    const reportDirectory = (await readdir(output)).find(name => name.startsWith(".sandbox-browser-"));
    expect(reportDirectory).toBeDefined();
    expect(JSON.parse(await readFile(path.join(output, reportDirectory!, "browser-server-report.json"), "utf8")).ok).toBe(true);
  });

  it("refuses missing ownership authority before any engine command", async () => {
    const command = vi.fn();
    await expect(runSandboxedPlaywright(["node", "test-command.mjs"], {
      env: { NODE_ENV: "test", DOCKER_HOST: "unix:///var/run/docker.sock" }, command
    })).rejects.toThrow(/coordinated cleanup context/);
    expect(command).not.toHaveBeenCalled();
  });

  it("registers and retires the exact recovered container when the create response is lost", async () => {
    const recovered = await runWithFakeEngine({ failCreateResponse: true });
    await expect(recovered.promise).rejects.toThrow(/injected create response failure/);
    expect(recovered.registered).toEqual([CHILD_ID]);
    expect(recovered.commands).toContainEqual(["rm", "--force", CHILD_ID]);
  });

  it("cleans an exactly labeled sibling after registration failure and refuses a label mismatch", async () => {
    const registrationFailure = await runWithFakeEngine({ failRegistration: true });
    await expect(registrationFailure.promise).rejects.toThrow(/injected registration failure/);
    expect(registrationFailure.commands).toContainEqual(["rm", "--force", CHILD_ID]);
    expect(registrationFailure.commands.some(args => args.includes("/tmp/browser-server.mjs"))).toBe(false);

    const tampered = await runWithFakeEngine({ tamperOwnership: true });
    await expect(tampered.promise).rejects.toThrow(/ownership labels/);
    expect(tampered.commands).not.toContainEqual(["rm", "--force", CHILD_ID]);
  });

  it("cleans up after command failure and preserves cleanup failure context", async () => {
    const failed = await runWithFakeEngine({ failTest: true });
    await expect(failed.promise).rejects.toThrow(/injected test command failure/);
    expect(failed.commands.at(-1)).toEqual(["rm", "--force", CHILD_ID]);
    const cleanup = await runWithFakeEngine({ failCleanup: true });
    await expect(cleanup.promise).rejects.toThrow(/injected remove failure/);
    const reportDirectory = (await readdir(cleanup.output)).find(name => name.startsWith(".sandbox-browser-"));
    expect(reportDirectory).toBeDefined();
    const report = JSON.parse(await readFile(path.join(cleanup.output, reportDirectory!, "browser-server-report.json"), "utf8"));
    expect(report.errors.some((error: string) => error.includes("injected remove failure"))).toBe(true);
  });

  it("fails cleanup when the exact owned ID remains present after removal", async () => {
    const retained = await runWithFakeEngine({ retainAfterRemove: true });
    await expect(retained.promise).rejects.toThrow(/browser container remained present after exact-ID removal/);
    expect(retained.commands.at(-1)).toEqual(["rm", "--force", CHILD_ID]);
    const reportDirectory = (await readdir(retained.output)).find(name => name.startsWith(".sandbox-browser-"));
    expect(reportDirectory).toBeDefined();
    const report = JSON.parse(await readFile(path.join(retained.output, reportDirectory!, "browser-server-report.json"), "utf8"));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain("browser container remained present after exact-ID removal");
  });

  it("fails the client command when the browser server exits unexpectedly after readiness", async () => {
    const fixture = await runWithFakeEngine({ unexpectedServerExit: true });
    await expect(fixture.promise).rejects.toThrow(/exited unexpectedly with code 17/);
    expect(fixture.commands.at(-1)).toEqual(["rm", "--force", CHILD_ID]);
  });

  it("redacts split browser endpoint tokens from real command stdout and stderr without a trailing newline", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = [
      "const first = 'browserType.connect: WebSocket ws://127.0.0.1:4000/secret-';",
      "const second = 'token failed with useful diagnostic';",
      "process.stdout.write(first); process.stderr.write(first);",
      "setTimeout(() => { process.stdout.write(second); process.stderr.write(second); }, 20);"
    ].join(" ");
    await expect(runSandboxedPlaywright([process.execPath, "-e", code], {
      env: { ...process.env, SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: "ws://127.0.0.1:4000/secret-token" }
    })).resolves.toMatchObject({ ok: true, exitCode: 0, reusedEndpoint: true });

    for (const calls of [stdout.mock.calls, stderr.mock.calls]) {
      const output = calls.map(([chunk]) => String(chunk)).join("");
      expect(output).not.toContain("secret-token");
      expect(output).toContain("[redacted-browser-endpoint]");
      expect(output).toBe("browserType.connect: WebSocket [redacted-browser-endpoint] failed with useful diagnostic\n");
    }
  });

  it("does not spawn an already-cancelled inherited command", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sandboxed-playwright-aborted-"));
    temporaryDirectories.push(directory);
    const marker = path.join(directory, "must-not-exist");
    const controller = AbortSignal.abort(new Error("already cancelled"));
    await expect(runSandboxedPlaywright([
      process.execPath,
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`
    ], { env: { ...process.env, SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: "ws://127.0.0.1:4000/token" }, signal: controller })).rejects.toThrow(/already cancelled/);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a TERM-triggered exit-zero as cancellation and kills commands trapping TERM", async () => {
    const endpoint = { ...process.env, SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: "ws://127.0.0.1:4000/token" };
    const exitsZero = new AbortController();
    const cancelZero = setTimeout(() => exitsZero.abort(new Error("cancel exit-zero")), 200);
    await expect(runSandboxedPlaywright([
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"
    ], { env: endpoint, signal: exitsZero.signal })).rejects.toThrow(/cancel exit-zero/);
    clearTimeout(cancelZero);

    const trapsTerm = new AbortController();
    const cancelTrap = setTimeout(() => trapsTerm.abort(new Error("cancel TERM trap")), 200);
    const startedAt = Date.now();
    await expect(runSandboxedPlaywright([
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    ], { env: endpoint, signal: trapsTerm.signal })).rejects.toThrow(/cancel TERM trap/);
    clearTimeout(cancelTrap);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("kills a TERM-trapping grandchild even when its command parent exits zero", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sandboxed-playwright-grandchild-"));
    temporaryDirectories.push(directory);
    const pidFile = path.join(directory, "grandchild.pid");
    const termFile = path.join(directory, "grandchild.term");
    const grandchildCode = `process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(termFile)}, 'trapped')); setInterval(() => {}, 1000)`;
    const parentCode = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(grandchildCode)}], { stdio: 'ignore' });`,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      "process.on('SIGTERM', () => process.exit(0));",
      "setInterval(() => {}, 1000);"
    ].join("\n");
    const controller = new AbortController();
    const endpointEnv = { ...process.env, SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: "ws://127.0.0.1:4000/token" };
    const cancellationTimer = setTimeout(() => controller.abort(new Error("cancel parent with grandchild")), 500);
    const startedAt = Date.now();
    await expect(runSandboxedPlaywright([process.execPath, "-e", parentCode], { env: endpointEnv, signal: controller.signal })).rejects.toThrow(/cancel parent with grandchild/);
    clearTimeout(cancellationTimer);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    const grandchildPid = Number(await readFile(pidFile, "utf8"));
    expect(await readFile(termFile, "utf8")).toBe("trapped");
    const readState = async () => {
      try {
        const stat = await readFile(`/proc/${grandchildPid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      }
    };
    let state = await readState();
    const deadline = Date.now() + 1_000;
    while (state !== "" && state !== "Z" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      state = await readState();
    }
    expect(state === "" || state === "Z", `grandchild ${grandchildPid} remained in state ${state || "missing"}`).toBe(true);
  });
});

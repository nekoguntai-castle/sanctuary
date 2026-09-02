import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const controlToken = "a".repeat(64);

const repoRoot = path.resolve(__dirname, "../..");
const forwarderPath = path.join(
  repoRoot,
  "scripts/ci/docker-exec-tcp-forwarder.mjs",
);

const servers: net.Server[] = [];
const children: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

const listenEchoServer = async (): Promise<number> => {
  const server = net.createServer((socket) => socket.pipe(socket));
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Echo server did not receive a TCP port");
      }
      resolve(address.port);
    });
  });
};

const readLine = (child: ChildProcess): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline !== -1) resolve(output.slice(0, newline));
    });
    child.once("error", reject);
    child.once("exit", (status) =>
      reject(new Error(`Forwarder exited before readiness with ${status}`)),
    );
  });

const roundTrip = (port: number, payload: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.end(payload));
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    socket.once("end", () => resolve(response));
    socket.once("error", reject);
  });

const requestControl = (
  host: string,
  port: number,
  token: string,
): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: "/shutdown",
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end();
  });

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  children.length = 0;
  servers.length = 0;
  temporaryDirectories.length = 0;
});

describe("Docker-exec TCP forwarder", () => {
  it("removes the connection timeout before long hardware approval reads", () => {
    const source = readFileSync(forwarderPath, "utf8");
    expect(source).toContain(
      'socket.create_connection(("127.0.0.1", remote_port), timeout=10)',
    );
    expect(source).toContain("upstream.settimeout(None)");
  });

  it.each([
    {
      arguments: ["container", "unsafe"],
      message: "--name value pairs",
    },
    {
      arguments: [
        "--container",
        "unsafe/container",
        "--controller-port",
        "9001",
        "--bridge-port",
        "21326",
        "--control-token",
        controlToken,
      ],
      message: "safe container name",
    },
    {
      arguments: [
        "--container",
        "safe-container",
        "--controller-port",
        "0",
        "--bridge-port",
        "not-a-port",
        "--control-token",
        controlToken,
      ],
      message: "Remote ports must be integers",
    },
    {
      arguments: [
        "--container",
        "safe-container",
        "--controller-port",
        "9001",
        "--bridge-port",
        "21326",
        "--control-token",
        "short",
      ],
      message: "256-bit lowercase hexadecimal control token",
    },
  ])("rejects malformed or unsafe arguments: $message", (testCase) => {
    const result = spawnSync(
      process.execPath,
      [forwarderPath, ...testCase.arguments],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(testCase.message);
  });

  it("keeps both Trezor channels on loopback and relays their bytes", async () => {
    const controllerPort = await listenEchoServer();
    const bridgePort = await listenEchoServer();
    const mockBin = mkdtempSync(path.join(tmpdir(), "trezor-forwarder-"));
    temporaryDirectories.push(mockBin);
    const mockDocker = path.join(mockBin, "docker");
    writeFileSync(
      mockDocker,
      `#!/usr/bin/env node
const net = require("node:net");
const port = Number(process.argv.at(-1));
const socket = net.createConnection(port, "127.0.0.1");
process.on("SIGTERM", () => {});
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on("error", (error) => { console.error(error.message); process.exit(1); });
`,
    );
    chmodSync(mockDocker, 0o755);

    const forwarder = spawn(
      process.execPath,
      [
        forwarderPath,
        "--container",
        "sanctuary-test",
        "--controller-port",
        String(controllerPort),
        "--bridge-port",
        String(bridgePort),
        "--control-token",
        controlToken,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(forwarder);

    const endpoints = JSON.parse(await readLine(forwarder)) as {
      host: string;
      controllerPort: number;
      bridgePort: number;
      controlPort: number;
    };
    expect(endpoints.host).toBe("127.0.0.1");
    await expect(
      roundTrip(endpoints.controllerPort, "controller"),
    ).resolves.toBe("controller");
    await expect(roundTrip(endpoints.bridgePort, "bridge")).resolves.toBe(
      "bridge",
    );

    const stuckSocket = net.createConnection(
      endpoints.controllerPort,
      endpoints.host,
    );
    await once(stuckSocket, "connect");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const unauthorizedStatus = await requestControl(
      endpoints.host,
      endpoints.controlPort,
      "b".repeat(64),
    );
    expect(unauthorizedStatus).toBe(401);

    const exitStatus = new Promise<number | null>((resolve) =>
      forwarder.once("exit", resolve),
    );
    const shutdownStarted = Date.now();
    const acceptedStatus = await requestControl(
      endpoints.host,
      endpoints.controlPort,
      controlToken,
    );
    expect(acceptedStatus).toBe(202);
    await expect(exitStatus).resolves.toBe(0);
    expect(Date.now() - shutdownStarted).toBeLessThan(4_000);
    stuckSocket.destroy();
  });
});

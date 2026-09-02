#!/usr/bin/env node

import net from "node:net";
import http from "node:http";
import process from "node:process";
import { spawn } from "node:child_process";

const REMOTE_RELAY = String.raw`
import os
import socket
import sys
import threading

remote_port = int(sys.argv[1])
upstream = socket.create_connection(("127.0.0.1", remote_port), timeout=10)
upstream.settimeout(None)

def upload():
    try:
        while True:
            data = os.read(0, 65536)
            if not data:
                upstream.shutdown(socket.SHUT_WR)
                return
            upstream.sendall(data)
    except (BrokenPipeError, ConnectionResetError, OSError):
        return

threading.Thread(target=upload, daemon=True).start()
try:
    while True:
        data = upstream.recv(65536)
        if not data:
            break
        os.write(1, data)
finally:
    upstream.close()
`;

const parseArguments = () => {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Forwarder arguments must be --name value pairs");
    }
    values.set(key, value);
  }

  const container = values.get("--container");
  const controllerPort = Number(values.get("--controller-port"));
  const bridgePort = Number(values.get("--bridge-port"));
  const controlToken = values.get("--control-token");
  if (!container || !/^[A-Za-z0-9._-]+$/.test(container)) {
    throw new Error("A safe container name is required");
  }
  for (const port of [controllerPort, bridgePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Remote ports must be integers from 1 through 65535");
    }
  }
  if (!controlToken || !/^[a-f0-9]{64}$/.test(controlToken)) {
    throw new Error(
      "A 256-bit lowercase hexadecimal control token is required",
    );
  }
  return { container, controllerPort, bridgePort, controlToken };
};

const activeChildren = new Set();
const activeSockets = new Set();

const createForwarder = (container, remotePort) =>
  net.createServer({ allowHalfOpen: true }, (socket) => {
    activeSockets.add(socket);
    const relay = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "python3",
        "-c",
        REMOTE_RELAY,
        String(remotePort),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    activeChildren.add(relay);
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket);
    relay.stderr.pipe(process.stderr);

    const abort = () => {
      activeChildren.delete(relay);
      activeSockets.delete(socket);
      if (!socket.destroyed) socket.destroy();
      if (!relay.stdin.destroyed) relay.stdin.end();
    };
    socket.on("error", abort);
    socket.on("close", () => {
      activeSockets.delete(socket);
      if (!relay.stdin.destroyed) relay.stdin.end();
    });
    relay.on("error", abort);
    relay.on("close", () => {
      activeChildren.delete(relay);
      if (!socket.destroyed) socket.end();
    });
  });

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Forwarder did not receive an IPv4 loopback port"));
        return;
      }
      resolve(address.port);
    });
  });

const { container, controllerPort, bridgePort, controlToken } =
  parseArguments();
const controllerServer = createForwarder(container, controllerPort);
const bridgeServer = createForwarder(container, bridgePort);
const [localControllerPort, localBridgePort] = await Promise.all([
  listen(controllerServer),
  listen(bridgeServer),
]);

let shutdownStarted = false;
const shutdown = () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  controllerServer.close();
  bridgeServer.close();
  controlServer.close();
  for (const socket of activeSockets) socket.destroy();
  for (const child of activeChildren) {
    if (!child.stdin.destroyed) child.stdin.end();
  }
};

const controlServer = http.createServer((request, response) => {
  const authenticated =
    request.headers.authorization === `Bearer ${controlToken}`;
  if (
    request.method !== "POST" ||
    request.url !== "/shutdown" ||
    !authenticated
  ) {
    response.writeHead(authenticated ? 404 : 401).end();
    return;
  }
  response.writeHead(202, { "content-type": "application/json" });
  response.end('{"state":"shutting_down"}\n', () => shutdown());
});
const localControlPort = await listen(controlServer);

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

process.stdout.write(
  `${JSON.stringify({
    host: "127.0.0.1",
    controllerPort: localControllerPort,
    bridgePort: localBridgePort,
    controlPort: localControlPort,
  })}\n`,
);

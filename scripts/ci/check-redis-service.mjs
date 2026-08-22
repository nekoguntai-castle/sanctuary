#!/usr/bin/env node
import net from "node:net";

const PING_REQUEST = "*1\r\n$4\r\nPING\r\n";
const MAX_RESPONSE_BYTES = 256;

function fail(message) {
  throw new Error(`check-redis-service: ${message}`);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail("port must be an integer from 1 through 65535");
  }
  return port;
}

function parseTimeoutSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
    fail("timeout must be an integer from 1 through 120 seconds");
  }
  return seconds;
}

function authenticatedPing(password) {
  if (password === undefined) {
    return { request: PING_REQUEST, expectedResponse: "+PONG\r\n" };
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(password)) {
    fail("password must contain 1 through 128 safe characters");
  }
  return {
    request:
      `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n` +
      PING_REQUEST,
    expectedResponse: "+OK\r\n+PONG\r\n",
  };
}

export function waitForRedis(host, port, timeoutSeconds, password) {
  const { request, expectedResponse } = authenticatedPing(password);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = "";
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutSeconds * 1_000);
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      response += chunk;
      if (response === expectedResponse) {
        finish();
      } else if (
        Buffer.byteLength(response) > MAX_RESPONSE_BYTES ||
        !expectedResponse.startsWith(response)
      ) {
        finish(new Error(`unexpected Redis response: ${JSON.stringify(response)}`));
      }
    });
    socket.once("timeout", () => finish(new Error("Redis PING timed out")));
    socket.once("error", (error) => finish(error));
    socket.once("end", () =>
      finish(new Error("Redis closed the connection before returning PONG")),
    );
  });
}

export async function runCli(args) {
  if ((args.length !== 3 && args.length !== 4) || !args[0]) {
    fail(
      "usage: check-redis-service.mjs <host> <port> <timeout-seconds> [password]",
    );
  }
  const [host, portValue, timeoutValue, password] = args;
  await waitForRedis(
    host,
    parsePort(portValue),
    parseTimeoutSeconds(timeoutValue),
    password,
  );
  process.stdout.write(`Redis PING succeeded at ${host}:${portValue}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

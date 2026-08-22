#!/usr/bin/env node
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  runCli,
  waitForRedis,
} from "../../scripts/ci/check-redis-service.mjs";

async function withRedisFixture(onConnection, assertion) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assertion(address.port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("accepts an exact fragmented Redis PONG response", async () => {
  await withRedisFixture(
    (socket) => {
      socket.once("data", (request) => {
        assert.equal(request.toString("utf8"), "*1\r\n$4\r\nPING\r\n");
        socket.write("+PO");
        socket.end("NG\r\n");
      });
    },
    async (port) => waitForRedis("127.0.0.1", port, 2),
  );
});

test("authenticates before accepting Redis PONG", async () => {
  await withRedisFixture(
    (socket) => {
      socket.once("data", (request) => {
        assert.equal(
          request.toString("utf8"),
          "*2\r\n$4\r\nAUTH\r\n$14\r\njob-password-1\r\n" +
            "*1\r\n$4\r\nPING\r\n",
        );
        socket.write("+OK\r\n+PO");
        socket.end("NG\r\n");
      });
    },
    async (port) =>
      waitForRedis("127.0.0.1", port, 2, "job-password-1"),
  );
});

test("rejects a Redis candidate with the wrong job password", async () => {
  await withRedisFixture(
    (socket) =>
      socket.once("data", () =>
        socket.end("-WRONGPASS invalid username-password pair\r\n"),
      ),
    async (port) => {
      await assert.rejects(
        waitForRedis("127.0.0.1", port, 2, "wrong-job-password"),
        /unexpected Redis response/u,
      );
    },
  );
});

test("rejects an unexpected service response", async () => {
  await withRedisFixture(
    (socket) => socket.once("data", () => socket.end("-ERR nope\r\n")),
    async (port) => {
      await assert.rejects(
        waitForRedis("127.0.0.1", port, 2),
        /unexpected Redis response/u,
      );
    },
  );
});

test("rejects a service that closes without PONG", async () => {
  await withRedisFixture(
    (socket) => socket.once("data", () => socket.end()),
    async (port) => {
      await assert.rejects(
        waitForRedis("127.0.0.1", port, 2),
        /closed the connection before returning PONG/u,
      );
    },
  );
});

test("bounds a service that never responds", async () => {
  await withRedisFixture(
    () => undefined,
    async (port) => {
      await assert.rejects(
        waitForRedis("127.0.0.1", port, 1),
        /PING timed out/u,
      );
    },
  );
});

test("rejects missing and invalid ports before connecting", async () => {
  await assert.rejects(runCli([]), /usage/u);
  for (const port of ["0", "65536", "not-a-port"]) {
    await assert.rejects(
      runCli(["127.0.0.1", port, "1"]),
      /port must be an integer from 1 through 65535/u,
    );
  }
});

test("rejects timeouts outside the bounded probe window", async () => {
  for (const timeout of ["0", "121", "1.5"]) {
    await assert.rejects(
      runCli(["127.0.0.1", "6379", timeout]),
      /timeout must be an integer from 1 through 120 seconds/u,
    );
  }
});

test("rejects unsafe or empty passwords before connecting", async () => {
  for (const password of ["", "space is unsafe", "x".repeat(129)]) {
    await assert.rejects(
      runCli(["127.0.0.1", "6379", "1", password]),
      /password must contain 1 through 128 safe characters/u,
    );
  }
});

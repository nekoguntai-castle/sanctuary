import assert from "node:assert/strict";
import test from "node:test";
import {
  ownedResourceNames,
  replayOwnershipLabels,
  startDatabase,
} from "../../scripts/perf/wallet-sync-high-fanout-replay.mjs";
import { waitForDatabaseReadiness } from "../../scripts/perf/wallet-sync-database-readiness.mjs";

function replayLabelMap(resourceClass) {
  const argumentsList = replayOwnershipLabels(resourceClass);
  const labels = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] !== "--label") continue;
    const separator = argumentsList[index + 1].indexOf("=");
    labels[argumentsList[index + 1].slice(0, separator)] = argumentsList[
      index + 1
    ].slice(separator + 1);
    index += 1;
  }
  return labels;
}

function inspectResult(
  resourceClass,
  name,
  immutableIdentity,
  state = "created",
) {
  const labels = replayLabelMap(resourceClass);
  if (resourceClass === "compose_network") {
    return JSON.stringify([
      { Id: immutableIdentity, Name: name, Labels: labels },
    ]);
  }
  return JSON.stringify([
    {
      Id: immutableIdentity,
      Name: `/${name}`,
      State: { Status: state },
      Config: { Labels: labels },
    },
  ]);
}

function databaseOperationResult(names, args) {
  const command = args[1];
  const subcommand = args[2];
  if (
    command === "network" &&
    (subcommand === "create" || subcommand === "ls")
  ) {
    return "a".repeat(64);
  }
  if (command === "run") return "b".repeat(64);
  if (command === "create") return "c".repeat(64);
  if (command === "container" && subcommand === "ls") {
    return args.join(" ").includes("-migration")
      ? "c".repeat(64)
      : "b".repeat(64);
  }
  if (command === "network" && subcommand === "inspect") {
    return inspectResult("compose_network", names.network, args.at(-1));
  }
  if (command !== "container" || subcommand !== "inspect") return "";
  const id = args.at(-1);
  const migration = id !== "b".repeat(64);
  const name = migration ? `${names.postgres}-migration` : names.postgres;
  return inspectResult(
    "compose_container",
    name,
    id,
    migration ? "created" : "running",
  );
}

function recordingDatabaseOperation(names, events) {
  return (args) => {
    events.push(args);
    return databaseOperationResult(names, args);
  };
}

test("database readiness requires a successful TCP SQL query before migration", async () => {
  const names = ownedResourceNames("rc11", "database-ready");
  const probes = [];
  const waits = [];
  let now = 0;
  await waitForDatabaseReadiness(names, "test-password", {
    timeoutMs: 30_000,
    intervalMs: 100,
    now: () => now,
    probe: (args, timeoutMs) => {
      probes.push({ args, timeoutMs });
      if (probes.length < 3) throw new Error("database system is starting up");
      return "1\n";
    },
    running: () => "true",
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });
  assert.equal(probes.length, 3);
  assert.deepEqual(waits, [100, 100]);
  assert.equal(probes[0].timeoutMs, 2_000);
  assert.deepEqual(probes[0].args, [
    "docker",
    "exec",
    "--env",
    "PGPASSWORD=test-password",
    names.postgres,
    "psql",
    "--host",
    "127.0.0.1",
    "--username",
    "sanctuary",
    "--dbname",
    "sanctuary_replay",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT 1",
  ]);
});

test("database readiness fails closed at the hard SQL probe deadline", async () => {
  let probes = 0;
  let now = 0;
  await assert.rejects(
    waitForDatabaseReadiness(
      ownedResourceNames("rc11", "database-timeout"),
      "test-password",
      {
        timeoutMs: 200,
        intervalMs: 100,
        now: () => now,
        probe: () => {
          probes += 1;
          throw new Error("persistent startup failure");
        },
        running: () => "true",
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      },
    ),
    /PostgreSQL readiness timeout/,
  );
  assert.equal(probes, 2);
  assert.equal(now, 200);
});

test("database readiness performs no probe with an exhausted budget", async () => {
  let probes = 0;
  await assert.rejects(
    waitForDatabaseReadiness(
      ownedResourceNames("rc11", "database-zero-budget"),
      "test-password",
      {
        timeoutMs: 0,
        probe: () => {
          probes += 1;
        },
      },
    ),
    /PostgreSQL readiness timeout/,
  );
  assert.equal(probes, 0);
});

test("database readiness caps each probe at the remaining deadline", async () => {
  const probeTimeouts = [];
  let now = 0;
  await assert.rejects(
    waitForDatabaseReadiness(
      ownedResourceNames("rc11", "database-partial-budget"),
      "test-password",
      {
        timeoutMs: 2_500,
        intervalMs: 100,
        now: () => now,
        probe: (_args, timeoutMs) => {
          probeTimeouts.push(timeoutMs);
          now += timeoutMs;
          throw new Error("persistent startup failure");
        },
        running: () => "true",
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      },
    ),
    /PostgreSQL readiness timeout/,
  );
  assert.deepEqual(probeTimeouts, [2_000, 400]);
  assert.equal(now, 2_500);
});

test("database readiness rejects a probe result completed at the deadline", async () => {
  let now = 0;
  await assert.rejects(
    waitForDatabaseReadiness(
      ownedResourceNames("rc11", "database-late-success"),
      "test-password",
      {
        timeoutMs: 100,
        now: () => now,
        probe: (_args, timeoutMs) => {
          now += timeoutMs;
          return "1\n";
        },
      },
    ),
    /PostgreSQL readiness timeout/,
  );
  assert.equal(now, 100);
});

test("database readiness fails immediately when the owned container exits", async () => {
  let waits = 0;
  await assert.rejects(
    waitForDatabaseReadiness(
      ownedResourceNames("rc11", "database-exited"),
      "test-password",
      {
        probe: () => {
          throw new Error("connection refused");
        },
        running: () => "false",
        wait: async () => {
          waits += 1;
        },
      },
    ),
    /PostgreSQL container exited before readiness/,
  );
  assert.equal(waits, 0);
});

test("database startup proves readiness before running migration exactly once", async () => {
  const names = ownedResourceNames("rc11", "database-order");
  const events = [];
  await startDatabase(names, "test-password", "subject-image", "max", {
    operation: recordingDatabaseOperation(names, events),
    onCreated: () => {},
    waitUntilReady: async (actualNames, password) => {
      assert.equal(actualNames, names);
      assert.equal(password, "test-password");
      events.push(["readiness-proven"]);
    },
  });
  assert.equal(events[0][1], "network");
  assert.equal(events[1][2], "ls");
  assert.equal(events[2][2], "inspect");
  assert.equal(events[3][1], "run");
  assert.equal(events[4][2], "ls");
  assert.equal(events[5][2], "inspect");
  assert.deepEqual(events[6], ["readiness-proven"]);
  assert.equal(events[7][1], "create");
  assert.equal(events[7].filter((value) => value === "migrate").length, 1);
  assert.equal(events[8][2], "ls");
  assert.equal(events[9][2], "inspect");
  assert.deepEqual(events[10], ["docker", "start", "--attach", "c".repeat(64)]);
  assert.equal(events.length, 11);
});

test("database startup never attempts migration when readiness fails", async () => {
  const operations = [];
  const names = ownedResourceNames("rc11", "database-no-migrate");
  await assert.rejects(
    startDatabase(names, "test-password", "subject-image", "live", {
      operation: (args) => {
        operations.push(args);
        if (args[1] === "network" && args[2] === "create")
          return "a".repeat(64);
        if (args[1] === "network" && args[2] === "ls") return "a".repeat(64);
        if (args[1] === "network" && args[2] === "inspect") {
          return inspectResult("compose_network", names.network, args.at(-1));
        }
        if (args[1] === "run") return "b".repeat(64);
        if (args[1] === "container" && args[2] === "ls") return "b".repeat(64);
        if (args[1] === "container" && args[2] === "inspect") {
          return inspectResult(
            "compose_container",
            names.postgres,
            args.at(-1),
            "running",
          );
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      },
      onCreated: () => {},
      waitUntilReady: async () => {
        throw new Error("readiness failed");
      },
    }),
    /readiness failed/,
  );
  assert.equal(operations.length, 6);
  assert.equal(
    operations.some((args) => args.includes("migrate")),
    false,
  );
});

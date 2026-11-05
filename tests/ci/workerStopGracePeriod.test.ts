import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function workerShutdownTimeoutMs(): number {
  const source = readRepoFile("server/src/worker/shutdownLifecycle.ts");
  const match = /export const WORKER_SHUTDOWN_TIMEOUT_MS = ([\d_]+);/.exec(source);
  if (!match) throw new Error("WORKER_SHUTDOWN_TIMEOUT_MS not found");
  return Number(match[1].replaceAll("_", ""));
}

function gracePeriodMs(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d+)s$/.exec(value) : null;
  return match ? Number(match[1]) * 1000 : null;
}

describe("worker container stop grace period", () => {
  it("outlasts the worker shutdown deadline so a draining worker can retire its heartbeat", () => {
    // A SIGKILL before retirement leaves the boot epoch behind, and the next boot
    // then holds wallet sync for the restart-marker TTL plus the drain horizon.
    const compose = parse(readRepoFile("docker-compose.yml")) as {
      services: Record<string, { stop_grace_period?: unknown }>;
    };

    const graceMs = gracePeriodMs(compose.services.worker.stop_grace_period);

    expect(graceMs).not.toBeNull();
    expect(graceMs!).toBeGreaterThan(workerShutdownTimeoutMs());
  });
});

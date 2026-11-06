import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "../../scripts/ownership/canonical-json.mjs";
import { readRegistrations } from "../../scripts/ownership/registration.mjs";
import {
  assertBrowserContainerOwnership,
  browserContainerOwnershipFromState,
  browserContainerOwnershipLabels,
  loadBrowserContainerOwnership,
  registerBrowserContainer
} from "../../scripts/ci/lib/browser-container-ownership.mjs";

const commit = "a".repeat(40);
const statePath = "/tmp/sanctuary-runtime/coordinator-state.json";
const engineEndpoint = "unix:///var/run/docker.sock";
const state = {
  phase: "trust_installed",
  resourceCreatedAt: "2026-11-04T12:00:00.000Z",
  authority: {
    authorityMode: "coordinator_managed",
    checkoutRoot: "/repo",
    runtimeDirectory: "/tmp/sanctuary-runtime",
    composeProjectName: "sanctuary-ci-run-123",
    deploymentId: "deployment-123",
    ownerId: "owner-1000",
    operationRunId: "run-123",
    checkoutCommit: commit
  }
};
const env = {
  SANCTUARY_CLEANUP_COORDINATED: "1",
  SANCTUARY_CLEANUP_ENGINE: "docker",
  SANCTUARY_CLEANUP_STATE: statePath,
  SANCTUARY_PROJECT_DIR: "/repo",
  SANCTUARY_OWNERSHIP_ROOT: "/tmp/sanctuary-runtime/ownership",
  SANCTUARY_PROJECT: "sanctuary-ci-run-123",
  SANCTUARY_DEPLOYMENT_ID: "deployment-123",
  SANCTUARY_OWNER_ID: "owner-1000",
  SANCTUARY_OPERATION_RUN_ID: "run-123",
  SANCTUARY_CLEANUP_CREATED_AT: "2026-11-04T12:00:00.000Z",
  SANCTUARY_RELEASE: "unreleased",
  SANCTUARY_COMMIT: commit,
  SANCTUARY_RESOURCE_LIFECYCLE: "obsolete"
} as NodeJS.ProcessEnv;

function ownership() {
  return browserContainerOwnershipFromState(env, state, { checkoutRoot: "/repo", statePath, engineEndpoint });
}

describe("browser container ownership", () => {
  it("loads only an active coordinator-managed run with matching exact environment identity", () => {
    const resolveEngineContext = vi.fn(({ engine }: { engine: string }) => {
      expect(engine).toBe("docker");
      return { engineGlobalArgs: ["--host", engineEndpoint] };
    });
    const result = loadBrowserContainerOwnership(env, (file, options) => {
      expect(file).toBe(statePath);
      expect(options).toEqual({ checkoutRoot: "/repo" });
      return { state };
    }, resolveEngineContext);
    expect(result).toMatchObject({
      project: "sanctuary-ci-run-123", deploymentId: "deployment-123",
      operationRunId: "run-123", lifecycle: "obsolete", cleanupPolicy: "exact_delete",
      ownershipRoot: "/tmp/sanctuary-runtime/ownership", engineEndpoint
    });
    expect(resolveEngineContext).toHaveBeenCalledOnce();
    expect(() => loadBrowserContainerOwnership({ ...env, SANCTUARY_CLEANUP_COORDINATED: "0" }, vi.fn())).toThrow(/coordinated cleanup context/);
    expect(() => loadBrowserContainerOwnership({ ...env, SANCTUARY_CLEANUP_ENGINE: "host" }, vi.fn())).toThrow(/Docker inventory/);
    expect(() => browserContainerOwnershipFromState(env, { ...state, phase: "subject_ready" }, { checkoutRoot: "/repo", statePath, engineEndpoint })).toThrow(/active coordinator-managed/);
    expect(() => browserContainerOwnershipFromState({ ...env, SANCTUARY_COMMIT: "b".repeat(40) }, state, { checkoutRoot: "/repo", statePath, engineEndpoint })).toThrow(/does not match/);
    expect(() => browserContainerOwnershipFromState({ ...env, SANCTUARY_OWNERSHIP_ROOT: "/tmp/other" }, state, { checkoutRoot: "/repo", statePath, engineEndpoint })).toThrow(/paths do not match/);
    expect(() => browserContainerOwnershipFromState(env, state, { checkoutRoot: "/repo", statePath, engineEndpoint: "tcp://engine:2375" })).toThrow(/canonical local Unix socket/);
  });

  it("places the complete canonical ownership tuple on the create payload and verifies exact identity", () => {
    const owner = ownership();
    const labels = browserContainerOwnershipLabels(owner);
    const record = {
      Id: "b".repeat(64), Name: "/sanctuary-browser-run-123",
      Config: { Labels: labels }
    };
    expect(assertBrowserContainerOwnership(record, owner, { id: record.Id, name: "sanctuary-browser-run-123" })).toBe(record.Id);
    expect(() => assertBrowserContainerOwnership({ ...record, Id: "c".repeat(64) }, owner, { id: record.Id, name: "sanctuary-browser-run-123" })).toThrow(/immutable ID/);
    expect(() => assertBrowserContainerOwnership({ ...record, Config: { Labels: { ...labels, "io.sanctuary.owner-id": "other" } } }, owner)).toThrow(/ownership labels/);
  });

  it("registers the exact immutable engine ID under the coordinator's signed ownership root", () => {
    const register = vi.fn(() => ({ path: "/registration/opaque.json" }));
    const owner = ownership();
    const id = "d".repeat(64);
    expect(registerBrowserContainer(owner, id, register)).toEqual({ path: "/registration/opaque.json" });
    expect(register).toHaveBeenCalledWith({
      deploymentId: owner.deploymentId, operationRunId: owner.operationRunId, ownerId: owner.ownerId,
      resourceClass: "compose_container", lifecycle: "obsolete", cleanupPolicy: "exact_delete",
      createdAt: owner.createdAt, createdByRelease: "unreleased", createdByCommit: commit,
      locatorKind: "engine_id", locator: id, immutableIdentity: id,
      metadataDigest: canonicalSha256({ kind: "engine_id", locator: id })
    }, { root: owner.ownershipRoot, checkoutRoot: owner.checkoutRoot });
    expect(() => registerBrowserContainer(owner, "short-id", register)).toThrow(/full immutable engine ID/);
  });

  it("writes a verifiable signed compose-container registration for the immutable ID", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "browser-ownership-registration-"));
    const checkoutRoot = path.join(root, "checkout");
    const ownershipRoot = path.join(root, "runtime", "ownership");
    await mkdir(checkoutRoot);
    const owner = { ...ownership(), checkoutRoot, ownershipRoot };
    try {
      const id = "e".repeat(64);
      registerBrowserContainer(owner, id);
      const [registration] = readRegistrations(ownershipRoot, { resourceClass: "compose_container", immutableIdentity: id });
      expect(registration).toMatchObject({
        resourceClass: "compose_container", locatorKind: "engine_id", locator: id,
        immutableIdentity: id, deploymentId: owner.deploymentId,
        operationRunId: owner.operationRunId, lifecycle: "obsolete", cleanupPolicy: "exact_delete"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});

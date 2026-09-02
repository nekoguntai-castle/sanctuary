/**
 * Tor Container Management
 *
 * Secure interface for managing the Tor proxy container via Docker socket proxy.
 * Binds every lifecycle action to the backend's explicit deployment manifest.
 */

import { createLogger } from "../logger";
import { getErrorMessage } from "../errors";
import { DOCKER_PROXY_URL } from "./common";
import type {
  ContainerInfo,
  ContainerInspect,
  ContainerStatus,
  ContainerActionResult,
} from "./types";

const log = createLogger("UTIL:DOCKER_TOR");
const TOR_REPOSITORY = "dperson/torproxy";
// Reviewed `latest` image identity; rotate only through container-image-lock review.
const TOR_DIGEST =
  "sha256:d8b5f1cf24f1b7a0aa334929a264b2606a107223dd0d51eb1cda8aae6fbeec53";
const TOR_IMAGE = `${TOR_REPOSITORY}@${TOR_DIGEST}`;
const DOCKER_PULL_TIMEOUT_MS = 120_000;
const DOCKER_ACTION_TIMEOUT_MS = 15_000;
const MAX_DOCKER_ERROR_LENGTH = 4_096;

const FULL_CONTAINER_ID = /^[0-9a-f]{64}$/;
const OWNERSHIP_LABEL_KEYS = {
  project: "io.sanctuary.project",
  deployment: "io.sanctuary.deployment-id",
  owner: "io.sanctuary.owner-id",
  resourceClass: "io.sanctuary.resource-class",
  lifecycle: "io.sanctuary.lifecycle",
  policy: "io.sanctuary.cleanup-policy",
  createdAt: "io.sanctuary.created-at",
  release: "io.sanctuary.created-by-release",
  commit: "io.sanctuary.created-by-commit",
  run: "io.sanctuary.creation-run-id",
} as const;

interface TorOwnership {
  project: string;
  containerName: string;
  labels: Record<string, string>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim())
    throw new Error(`${name} is required for Tor ownership`);
  return value.trim();
}

function currentTorOwnership(): TorOwnership {
  const project = requiredEnvironment("SANCTUARY_PROJECT");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(project)) {
    throw new Error("SANCTUARY_PROJECT is invalid for Tor ownership");
  }
  return {
    project,
    containerName: `${project}-tor`,
    labels: {
      [OWNERSHIP_LABEL_KEYS.project]: project,
      [OWNERSHIP_LABEL_KEYS.deployment]: requiredEnvironment(
        "SANCTUARY_DEPLOYMENT_ID",
      ),
      [OWNERSHIP_LABEL_KEYS.owner]: requiredEnvironment("SANCTUARY_OWNER_ID"),
      [OWNERSHIP_LABEL_KEYS.resourceClass]: "compose_container",
      [OWNERSHIP_LABEL_KEYS.lifecycle]: requiredEnvironment(
        "SANCTUARY_RESOURCE_LIFECYCLE",
      ),
      [OWNERSHIP_LABEL_KEYS.policy]: "exact_delete",
      [OWNERSHIP_LABEL_KEYS.createdAt]: requiredEnvironment(
        "SANCTUARY_CLEANUP_CREATED_AT",
      ),
      [OWNERSHIP_LABEL_KEYS.release]: requiredEnvironment("SANCTUARY_RELEASE"),
      [OWNERSHIP_LABEL_KEYS.commit]: requiredEnvironment("SANCTUARY_COMMIT"),
      [OWNERSHIP_LABEL_KEYS.run]: requiredEnvironment(
        "SANCTUARY_OPERATION_RUN_ID",
      ),
      "com.docker.compose.project": project,
      "com.docker.compose.service": "tor",
    },
  };
}

function labelsMatch(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  return (
    !!actual &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function summaryHasExactIdentity(
  container: ContainerInfo,
  ownership: TorOwnership,
): boolean {
  return (
    FULL_CONTAINER_ID.test(container.Id) &&
    container.Names.includes(`/${ownership.containerName}`) &&
    labelsMatch(container.Labels, ownership.labels)
  );
}

interface DockerPullEvent {
  error?: unknown;
  errorDetail?: unknown;
}

const parseDockerPullEvent = (line: string): DockerPullEvent | null => {
  try {
    return JSON.parse(line) as DockerPullEvent;
  } catch {
    return null;
  }
};

const nonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 ? value : null;
};

const dockerPullError = (line: string): string | null => {
  const event = parseDockerPullEvent(line);
  if (!event) return null;
  if (event.errorDetail && typeof event.errorDetail === "object") {
    const detail = event.errorDetail as { message?: unknown };
    const detailMessage = nonEmptyString(detail.message);
    if (detailMessage) return detailMessage;
  }
  return nonEmptyString(event.error);
};

async function drainDockerPull(response: Response): Promise<string | null> {
  if (!response.body) {
    return dockerPullError(await response.text());
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    if (pending.length > MAX_DOCKER_ERROR_LENGTH && !pending.includes("\n")) {
      await reader.cancel();
      return "Docker pull response contained an oversized progress event";
    }
    const lines = pending.split("\n");
    pending = lines.pop()!;
    for (const line of lines) {
      const error = dockerPullError(line);
      if (error) {
        await reader.cancel();
        return error.slice(0, MAX_DOCKER_ERROR_LENGTH);
      }
    }
    if (done) {
      const finalError = dockerPullError(pending);
      return finalError ? finalError.slice(0, MAX_DOCKER_ERROR_LENGTH) : null;
    }
  }
}

/**
 * Find tor container by pattern
 * Returns the container info if found
 */
async function findTorContainer(): Promise<ContainerInfo | null> {
  const ownership = currentTorOwnership();
  const response = await fetch(`${DOCKER_PROXY_URL}/containers/json?all=true`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(DOCKER_ACTION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Tor container listing failed with status ${response.status}`,
    );
  }
  const containers = (await response.json()) as ContainerInfo[];
  if (!Array.isArray(containers)) {
    throw new Error("Tor container listing returned an invalid response");
  }
  const exactName = `/${ownership.containerName}`;
  const named = containers.filter((container) =>
    container.Names.includes(exactName),
  );
  if (named.length === 0) return null;
  if (named.length !== 1 || !summaryHasExactIdentity(named[0], ownership)) {
    throw new Error("Tor container exact ownership identity is ambiguous");
  }
  return named[0];
}

async function inspectContainer(
  selector: string,
): Promise<ContainerInspect | null> {
  const response = await fetch(
    `${DOCKER_PROXY_URL}/containers/${encodeURIComponent(selector)}/json`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(DOCKER_ACTION_TIMEOUT_MS),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Tor inspect failed with status ${response.status}`);
  return (await response.json()) as ContainerInspect;
}

function inspectHasCreatedIdentity(
  inspect: ContainerInspect,
  ownership: TorOwnership,
): boolean {
  return (
    FULL_CONTAINER_ID.test(inspect.Id) &&
    inspect.Name === `/${ownership.containerName}` &&
    inspect.State.Status === "created" &&
    inspect.State.Running === false &&
    labelsMatch(inspect.Config?.Labels, ownership.labels)
  );
}

async function recoverCreatedTor(
  ownership: TorOwnership,
): Promise<string | null> {
  const byName = await inspectContainer(ownership.containerName);
  if (!byName || !inspectHasCreatedIdentity(byName, ownership)) return null;
  const byId = await inspectContainer(byName.Id);
  if (
    !byId ||
    !inspectHasCreatedIdentity(byId, ownership) ||
    byId.Id !== byName.Id
  )
    return null;
  return byName.Id;
}

async function verifyReturnedContainerId(
  containerId: unknown,
  ownership: TorOwnership,
): Promise<string | null> {
  if (typeof containerId !== "string" || !FULL_CONTAINER_ID.test(containerId)) {
    return recoverCreatedTor(ownership);
  }
  const inspected = await inspectContainer(containerId);
  if (
    !inspected ||
    inspected.Id !== containerId ||
    !inspectHasCreatedIdentity(inspected, ownership)
  ) {
    return null;
  }
  return containerId;
}

async function verifyCreateResponse(
  response: Response,
  ownership: TorOwnership,
): Promise<string | null> {
  let result: { Id?: unknown };
  try {
    result = (await response.json()) as { Id?: unknown };
  } catch {
    return recoverCreatedTor(ownership);
  }
  return verifyReturnedContainerId(result?.Id, ownership);
}

async function startExactContainer(containerId: string): Promise<Response> {
  if (!FULL_CONTAINER_ID.test(containerId))
    throw new Error("Tor container ID is not immutable");
  return fetch(`${DOCKER_PROXY_URL}/containers/${containerId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(DOCKER_ACTION_TIMEOUT_MS),
  });
}

function inspectHasRuntimeIdentity(
  inspect: ContainerInspect,
  ownership: TorOwnership,
  running: boolean,
): boolean {
  return (
    FULL_CONTAINER_ID.test(inspect.Id) &&
    inspect.Name === `/${ownership.containerName}` &&
    inspect.State.Running === running &&
    labelsMatch(inspect.Config?.Labels, ownership.labels)
  );
}

async function exactRuntimeStateReached(
  containerId: string,
  ownership: TorOwnership,
  running: boolean,
): Promise<boolean> {
  const first = await inspectContainer(containerId);
  if (!first || !inspectHasRuntimeIdentity(first, ownership, running))
    return false;
  const second = await inspectContainer(containerId);
  return (
    !!second &&
    second.Id === first.Id &&
    inspectHasRuntimeIdentity(second, ownership, running)
  );
}

async function safelyReachedRuntimeState(
  containerId: string,
  ownership: TorOwnership,
  running: boolean,
): Promise<boolean> {
  try {
    return await exactRuntimeStateReached(containerId, ownership, running);
  } catch {
    return false;
  }
}

interface StateMutationResult {
  success: boolean;
  error?: string;
}

async function reconcileStateMutation(
  request: () => Promise<Response>,
  containerId: string,
  ownership: TorOwnership,
  running: boolean,
): Promise<StateMutationResult> {
  try {
    const response = await request();
    if (response.status === 204 || response.status === 304)
      return { success: true };
    const error = await response.text();
    if (await safelyReachedRuntimeState(containerId, ownership, running))
      return { success: true };
    return { success: false, error };
  } catch (error) {
    if (await safelyReachedRuntimeState(containerId, ownership, running))
      return { success: true };
    return { success: false, error: getErrorMessage(error) };
  }
}

function ownershipUnavailable(status: ContainerStatus): ContainerActionResult {
  const detail = status.error ? `: ${status.error}` : "";
  return {
    success: false,
    message: `Tor ownership status is unavailable${detail}`,
  };
}

/**
 * Get Tor container status
 */
export async function getTorStatus(): Promise<ContainerStatus> {
  try {
    const tor = await findTorContainer();

    if (!tor) {
      return { exists: false, running: false, status: "not_created" };
    }

    return {
      exists: true,
      running: tor.State === "running",
      status: tor.State,
      containerId: tor.Id,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    log.error("Error getting Tor status", { error: message });
    return { exists: false, running: false, status: "error", error: message };
  }
}

/**
 * Create and start the Tor container
 */
export async function createTorContainer(): Promise<ContainerActionResult> {
  try {
    const ownership = currentTorOwnership();
    // Check if already exists
    const status = await getTorStatus();
    if (status.status === "error") {
      return ownershipUnavailable(status);
    }
    if (status.exists) {
      if (status.running) {
        return { success: true, message: "Tor container is already running" };
      }
      // Start existing container
      return startTor();
    }

    log.info("Creating Tor container...");

    // First, pull the image
    const pullResponse = await fetch(
      `${DOCKER_PROXY_URL}/images/create?fromImage=${encodeURIComponent(TOR_REPOSITORY)}&tag=${encodeURIComponent(TOR_DIGEST)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(DOCKER_PULL_TIMEOUT_MS),
      },
    );

    if (!pullResponse.ok) {
      const errorText = (await pullResponse.text()).slice(
        0,
        MAX_DOCKER_ERROR_LENGTH,
      );
      log.warn("Failed to pull Tor image", {
        status: pullResponse.status,
        error: errorText,
      });
      return {
        success: false,
        message: `Failed to pull Tor image: ${errorText}`,
      };
    }

    // Docker reports registry failures inside an HTTP-200 JSON progress stream.
    const pullError = await drainDockerPull(pullResponse);
    if (pullError) {
      log.warn("Failed to pull Tor image", { error: pullError });
      return {
        success: false,
        message: `Failed to pull Tor image: ${pullError}`,
      };
    }
    log.info("Tor image pulled successfully");

    // Get the network name (Docker Compose format: {project}_{network-name})
    const networkName = `${ownership.project}_sanctuary-network`;

    // Create the container with network alias so it's resolvable as 'tor'
    const containerConfig = {
      Image: TOR_IMAGE,
      Env: ["LOCATION="],
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped" },
        LogConfig: {
          Type: "json-file",
          Config: {
            "max-size": "10m",
            "max-file": "3",
          },
        },
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {
            Aliases: ["tor"],
          },
        },
      },
      Labels: {
        ...ownership.labels,
      },
    };

    let createResponse: Response | null = null;
    let createFailure = "";
    try {
      createResponse = await fetch(
        `${DOCKER_PROXY_URL}/containers/create?name=${encodeURIComponent(ownership.containerName)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerConfig),
          signal: AbortSignal.timeout(DOCKER_ACTION_TIMEOUT_MS),
        },
      );
      if (!createResponse.ok) createFailure = await createResponse.text();
    } catch (error) {
      createFailure = getErrorMessage(
        error,
        "Docker create response unavailable",
      );
    }

    let containerId: string | null = null;
    if (createResponse?.ok) {
      containerId = await verifyCreateResponse(createResponse, ownership);
    } else {
      containerId = await recoverCreatedTor(ownership);
    }
    if (!containerId) {
      return {
        success: false,
        message: `Failed to create Tor container: ${createFailure || "identity verification failed"}`,
      };
    }
    log.info("Tor container created", { id: containerId });

    // Start the container
    const startResult = await reconcileStateMutation(
      () => startExactContainer(containerId),
      containerId,
      ownership,
      true,
    );

    if (startResult.success) {
      log.info("Tor container started");
      return {
        success: true,
        message: "Tor container created and started successfully",
      };
    }

    const errorText = startResult.error ?? "unknown Docker start failure";
    log.warn("Failed to start Tor container", {
      error: errorText,
    });
    return {
      success: false,
      message: `Container created but failed to start: ${errorText}`,
    };
  } catch (error) {
    log.error("Error creating Tor container", {
      error: getErrorMessage(error),
    });
    return {
      success: false,
      message: getErrorMessage(error, "Failed to create Tor container"),
    };
  }
}

/**
 * Start the Tor container
 */
export async function startTor(): Promise<ContainerActionResult> {
  try {
    const ownership = currentTorOwnership();
    const status = await getTorStatus();
    if (status.status === "error") {
      return ownershipUnavailable(status);
    }

    if (!status.exists || !status.containerId) {
      // Try to create and start
      return createTorContainer();
    }

    if (status.running) {
      return { success: true, message: "Tor is already running" };
    }

    // Start the container using its ID
    const result = await reconcileStateMutation(
      () => startExactContainer(status.containerId!),
      status.containerId,
      ownership,
      true,
    );

    if (result.success) {
      log.info("Tor container started");
      return { success: true, message: "Tor started successfully" };
    }

    const errorText = result.error ?? "unknown Docker start failure";
    log.warn("Failed to start Tor", {
      error: errorText,
    });
    return { success: false, message: `Failed to start Tor: ${errorText}` };
  } catch (error) {
    log.error("Error starting Tor", { error: getErrorMessage(error) });
    return {
      success: false,
      message: getErrorMessage(error, "Failed to start Tor"),
    };
  }
}

/**
 * Stop the Tor container
 */
export async function stopTor(): Promise<ContainerActionResult> {
  try {
    const ownership = currentTorOwnership();
    const status = await getTorStatus();
    if (status.status === "error") {
      return ownershipUnavailable(status);
    }

    if (!status.exists || !status.containerId) {
      return { success: true, message: "Tor container does not exist" };
    }

    if (!status.running) {
      return { success: true, message: "Tor is already stopped" };
    }

    // Stop the container using its ID (with 10 second timeout)
    if (!FULL_CONTAINER_ID.test(status.containerId)) {
      return { success: false, message: "Tor container ID is not immutable" };
    }
    const result = await reconcileStateMutation(
      () =>
        fetch(`${DOCKER_PROXY_URL}/containers/${status.containerId}/stop?t=10`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(DOCKER_ACTION_TIMEOUT_MS),
        }),
      status.containerId,
      ownership,
      false,
    );

    if (result.success) {
      log.info("Tor container stopped");
      return { success: true, message: "Tor stopped successfully" };
    }

    const errorText = result.error ?? "unknown Docker stop failure";
    log.warn("Failed to stop Tor", {
      error: errorText,
    });
    return { success: false, message: `Failed to stop Tor: ${errorText}` };
  } catch (error) {
    log.error("Error stopping Tor", { error: getErrorMessage(error) });
    return {
      success: false,
      message: getErrorMessage(error, "Failed to stop Tor"),
    };
  }
}

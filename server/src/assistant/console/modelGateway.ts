import { ServiceUnavailableError } from "../../errors/ApiError";
import {
  getAIConfig,
  getContainerUrl,
  syncConfigToContainer,
} from "../../services/ai/config";
import { buildAIProxyJsonHeaders } from "../../services/ai/proxyClient";
import { getErrorMessage } from "../../utils/errors";
import { createLogger } from "../../utils/logger";
import type { ConsoleScope, ConsoleToolCall } from "./protocol";

const log = createLogger("ASSISTANT:CONSOLE_GATEWAY");
const AI_CONTAINER_URL = getContainerUrl();
const CONSOLE_GATEWAY_TIMEOUT_DEFAULT_MS = 125_000;
const CONSOLE_GATEWAY_TIMEOUT_MS = getConsoleGatewayTimeoutMs();

export interface ConsoleGatewayToolDescription {
  name: string;
  title: string;
  description: string;
  sensitivity: string;
  requiredScope: string;
  inputFields: string[];
}

export interface ConsoleGatewayPlan {
  toolCalls: ConsoleToolCall[];
  warnings: string[];
}

export interface ConsoleGatewayToolResult {
  toolName: string;
  status: "completed" | "denied" | "failed";
  input?: unknown;
  sensitivity?: string;
  facts?: unknown;
  provenance?: unknown;
  redactions?: unknown;
  truncation?: unknown;
  warnings?: unknown;
  error?: string;
}

export interface ConsoleGatewayProviderState {
  providerProfileId?: string;
  model?: string;
}

export interface ConsoleGatewayContext {
  mode: "auto";
  currentWalletId?: string;
  currentWalletName?: string;
  wallets: Array<{
    id: string;
    name: string;
    network?: string | null;
  }>;
  walletLimitApplied?: boolean;
}

type ConsoleProviderSetupReason =
  | "provider_not_configured"
  | "provider_config_sync_failed";

interface ConsoleProxyFailure {
  message: string | null;
  reason: ConsoleProviderSetupReason | null;
}

function getConsoleGatewayTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.CONSOLE_GATEWAY_TIMEOUT_MS || "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : CONSOLE_GATEWAY_TIMEOUT_DEFAULT_MS;
}

function consoleSetupError(
  message: string,
  reason: ConsoleProviderSetupReason,
): ServiceUnavailableError {
  return new ServiceUnavailableError(message, "SERVICE_UNAVAILABLE", {
    reason,
  });
}

async function ensureConfiguredProvider(): Promise<ConsoleGatewayProviderState> {
  const config = await getAIConfig();
  if (!config.enabled || !config.endpoint || !config.model) {
    throw consoleSetupError(
      "AI provider is not configured for Sanctuary Console",
      "provider_not_configured",
    );
  }
  const synced = await syncConfigToContainer(config);
  if (!synced) {
    throw consoleSetupError(
      "AI provider configuration could not be synced for Sanctuary Console",
      "provider_config_sync_failed",
    );
  }
  return {
    providerProfileId: config.providerProfileId,
    model: config.model,
  };
}

async function fetchConsoleGateway<TResponse>(
  path: "/console/plan" | "/console/synthesize",
  body: Record<string, unknown>,
): Promise<TResponse> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}${path}`, {
      method: "POST",
      headers: buildAIProxyJsonHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONSOLE_GATEWAY_TIMEOUT_MS),
    });

    if (!response.ok) {
      const proxyFailure = await readProxyFailure(response);
      throw new ServiceUnavailableError(
        proxyFailure.message
          ? `AI proxy ${path} request failed: ${proxyFailure.message}`
          : `AI proxy ${path} request failed`,
        "SERVICE_UNAVAILABLE",
        {
          path,
          status: response.status,
          ...(proxyFailure.message ? { proxyError: proxyFailure.message } : {}),
          ...(proxyFailure.reason ? { reason: proxyFailure.reason } : {}),
        },
      );
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    log.error("Console AI proxy request failed", {
      path,
      error: getErrorMessage(error),
    });
    throw new ServiceUnavailableError(
      "AI proxy is not available for Sanctuary Console",
    );
  }
}

function normalizeConsoleProviderSetupReason(
  reason: unknown,
): ConsoleProviderSetupReason | null {
  switch (reason) {
    case "provider_not_configured":
    case "not_configured":
      return "provider_not_configured";
    case "provider_config_sync_failed":
      return "provider_config_sync_failed";
    default:
      return null;
  }
}

async function readProxyFailure(
  response: Response,
): Promise<ConsoleProxyFailure> {
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      reason?: unknown;
    };
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : null;
    return {
      message,
      reason: normalizeConsoleProviderSetupReason(body.reason),
    };
  } catch {
    return { message: null, reason: null };
  }
}

export async function planConsoleTools(input: {
  prompt: string;
  scope: ConsoleScope;
  context?: ConsoleGatewayContext;
  maxToolCalls: number;
  tools: ConsoleGatewayToolDescription[];
}): Promise<ConsoleGatewayPlan & ConsoleGatewayProviderState> {
  const provider = await ensureConfiguredProvider();
  const plan = await fetchConsoleGateway<ConsoleGatewayPlan>(
    "/console/plan",
    input,
  );
  return {
    ...provider,
    toolCalls: plan.toolCalls ?? [],
    warnings: plan.warnings ?? [],
  };
}

export async function synthesizeConsoleAnswer(input: {
  prompt: string;
  scope: ConsoleScope;
  context?: ConsoleGatewayContext;
  toolResults: ConsoleGatewayToolResult[];
}): Promise<{ response: string } & ConsoleGatewayProviderState> {
  const provider = await ensureConfiguredProvider();
  const result = await fetchConsoleGateway<{ response?: string }>(
    "/console/synthesize",
    input,
  );
  return {
    ...provider,
    response: typeof result.response === "string" ? result.response : "",
  };
}

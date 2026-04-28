import {
  AssistantToolError,
  assistantReadToolRegistry,
  type AssistantReadToolDefinition,
  type AssistantToolContext,
} from "../tools";
import type { Prisma } from "../../generated/prisma/client";
import {
  InsufficientPermissionsError,
  WalletNotFoundError,
} from "../../errors/ApiError";
import { consoleRepository, walletRepository } from "../../repositories";
import type { AssistantToolActor } from "../tools";
import {
  compactToolEnvelope,
  scopeIncludesWallet,
  scopeWalletIds,
  sensitivityAllowed,
  type ConsoleScope,
  type ConsoleSensitivity,
  type ConsoleToolCall,
} from "./protocol";
import type { ConsoleGatewayToolResult } from "./modelGateway";

export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isWalletScoped(scope: ConsoleScope): boolean {
  return ["wallet", "wallet_set", "object"].includes(scope.kind);
}

async function assertWalletAccess(
  userId: string,
  walletId: string,
): Promise<void> {
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);
  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }
}

export async function assertScopeAccess(
  actor: AssistantToolActor,
  scope: ConsoleScope,
): Promise<void> {
  if (scope.kind === "admin" && !actor.isAdmin) {
    throw new InsufficientPermissionsError(
      "Console admin scope requires an admin user",
    );
  }
  await Promise.all(
    scopeWalletIds(scope).map((walletId) =>
      assertWalletAccess(actor.userId, walletId),
    ),
  );
}

function createToolContext(
  actor: AssistantToolActor,
  scope: ConsoleScope,
): AssistantToolContext {
  return {
    source: "console",
    actor,
    walletScopeIds: scopeWalletIds(scope),
    async authorizeWalletAccess(walletId: string) {
      if (!scopeIncludesWallet(scope, walletId)) {
        throw new AssistantToolError(
          403,
          "Tool call is outside the selected Console wallet scope",
        );
      }
      const wallet = await walletRepository.findByIdWithAccess(
        walletId,
        actor.userId,
      );
      if (!wallet) {
        throw new AssistantToolError(404, "Wallet not found");
      }
    },
    async authorizeAuditAccess() {
      if (!actor.isAdmin) {
        throw new AssistantToolError(
          403,
          "Console audit access requires an admin user",
        );
      }
    },
  };
}

function toolNeedsExplicitScope(
  definition: AssistantReadToolDefinition,
): boolean {
  return (
    definition.sensitivity === "wallet" || definition.sensitivity === "high"
  );
}

function walletInputFromCall(
  definition: AssistantReadToolDefinition,
  call: ConsoleToolCall,
): string | null {
  const field = definition.requiredScope.walletIdInput ?? "walletId";
  const value = call.input[field];
  return typeof value === "string" ? value : null;
}

function validateToolCall(
  definition: AssistantReadToolDefinition,
  call: ConsoleToolCall,
  scope: ConsoleScope,
  maxSensitivity: ConsoleSensitivity,
  actor: AssistantToolActor,
): string | null {
  if (!sensitivityAllowed(definition.sensitivity, maxSensitivity)) {
    return `Tool sensitivity ${definition.sensitivity} exceeds turn limit ${maxSensitivity}`;
  }
  if (
    (definition.requiredScope.kind === "admin" ||
      definition.requiredScope.kind === "audit") &&
    !actor.isAdmin
  ) {
    return "Tool requires admin access";
  }
  if (toolNeedsExplicitScope(definition) && !isWalletScoped(scope)) {
    return "Wallet-sensitive tools require an explicit wallet scope";
  }
  if (definition.requiredScope.kind === "wallet") {
    const walletId = walletInputFromCall(definition, call);
    return walletId && scopeIncludesWallet(scope, walletId)
      ? null
      : "Tool wallet input is outside the selected scope";
  }
  return null;
}

async function storeTrace(
  input: Parameters<typeof consoleRepository.createToolTrace>[0],
) {
  return consoleRepository.createToolTrace(input);
}

export function traceForSynthesis(
  trace: Awaited<ReturnType<typeof storeTrace>>,
): ConsoleGatewayToolResult {
  return {
    toolName: trace.toolName,
    status: trace.status as ConsoleGatewayToolResult["status"],
    ...(trace.input ? { input: trace.input } : {}),
    ...(trace.sensitivity ? { sensitivity: trace.sensitivity } : {}),
    ...(trace.facts ? { facts: trace.facts } : {}),
    ...(trace.provenance ? { provenance: trace.provenance } : {}),
    ...(trace.redactions ? { redactions: trace.redactions } : {}),
    ...(trace.truncation ? { truncation: trace.truncation } : {}),
    ...(trace.warnings ? { warnings: trace.warnings } : {}),
    ...(trace.errorMessage ? { error: trace.errorMessage } : {}),
  };
}

async function storeDeniedTrace(input: {
  turnId: string;
  toolName: string;
  callInput: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
  sensitivity?: string;
}) {
  return storeTrace({
    turnId: input.turnId,
    toolName: input.toolName,
    status: "denied",
    input: toJson(input.callInput),
    sensitivity: input.sensitivity,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  });
}

export async function executePlannedTool(input: {
  call: ConsoleToolCall;
  turnId: string;
  scope: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  actor: AssistantToolActor;
}) {
  const definition = assistantReadToolRegistry.get(input.call.name);
  if (!definition) {
    return storeDeniedTrace({
      turnId: input.turnId,
      toolName: input.call.name,
      callInput: input.call.input,
      errorCode: "unknown_tool",
      errorMessage: "Unknown console tool requested",
    });
  }

  const denial = validateToolCall(
    definition,
    input.call,
    input.scope,
    input.maxSensitivity,
    input.actor,
  );
  if (denial) {
    return storeDeniedTrace({
      turnId: input.turnId,
      toolName: definition.name,
      callInput: input.call.input,
      errorCode: "tool_denied",
      errorMessage: denial,
      sensitivity: definition.sensitivity,
    });
  }

  try {
    const context = createToolContext(input.actor, input.scope);
    const envelope = await assistantReadToolRegistry.execute(
      definition.name,
      input.call.input,
      context,
    );
    const compact = compactToolEnvelope(envelope);
    return storeTrace({
      turnId: input.turnId,
      toolName: definition.name,
      status: "completed",
      input: toJson(input.call.input),
      facts: toJson(compact.facts),
      provenance: toJson(compact.provenance),
      redactions: toJson(compact.redactions),
      truncation: toJson(compact.truncation),
      warnings: toJson(compact.warnings),
      sensitivity: envelope.sensitivity,
      rowCount: envelope.audit.rowCount ?? null,
      walletCount: envelope.audit.walletCount ?? null,
      durationMs: envelope.audit.durationMs ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tool execution failed";
    return storeTrace({
      turnId: input.turnId,
      toolName: definition.name,
      status:
        error instanceof AssistantToolError && error.statusCode === 403
          ? "denied"
          : "failed",
      input: toJson(input.call.input),
      sensitivity: definition.sensitivity,
      errorCode:
        error instanceof AssistantToolError
          ? String(error.code)
          : "tool_failed",
      errorMessage: message,
    });
  }
}

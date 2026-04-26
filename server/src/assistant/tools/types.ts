import * as z from 'zod/v4';

export type AssistantToolSource = 'mcp' | 'console' | 'test';
export type AssistantToolSensitivity = 'public' | 'wallet' | 'high' | 'admin';
export type AssistantToolScopeKind = 'authenticated' | 'wallet' | 'wallet_set' | 'admin' | 'audit';

export interface AssistantToolActor {
  userId: string;
  username?: string;
  isAdmin: boolean;
}

export interface AssistantToolContext {
  source: AssistantToolSource;
  actor: AssistantToolActor;
  requestId?: string;
  authorizeWalletAccess(walletId: string): Promise<void>;
  authorizeAuditAccess?(): Promise<void>;
}

export interface AssistantToolScope {
  kind: AssistantToolScopeKind;
  walletIdInput?: string;
  walletIdsInput?: string;
  description: string;
}

export interface AssistantToolBudget {
  maxRows?: number;
  maxWallets?: number;
  maxBytes?: number;
}

export interface AssistantToolFact {
  label: string;
  value: string | number | boolean | null;
  unit?: string;
}

export interface AssistantToolFacts {
  summary: string;
  items: AssistantToolFact[];
}

export interface AssistantToolProvenance {
  sources: Array<{
    type: 'sanctuary_repository' | 'sanctuary_cache' | 'computed';
    label: string;
    asOf?: string | null;
  }>;
  computedAt: string;
}

export interface AssistantToolTruncation {
  truncated: boolean;
  reason?: 'row_limit' | 'byte_budget';
  rowLimit?: number;
  returnedRows?: number;
}

export interface AssistantToolAudit {
  operation: string;
  source: AssistantToolSource;
  sensitivity: AssistantToolSensitivity;
  scope: AssistantToolScopeKind;
  walletCount?: number;
  rowCount?: number;
  durationMs?: number;
}

/**
 * Backend-owned tool result contract shared by MCP and the in-app Console.
 * Adapters may choose which fields to send to a model, but executors must
 * always return data plus provenance, sensitivity, truncation, and redaction
 * metadata so GUI-equivalent reads remain auditable and explainable.
 */
export interface AssistantToolEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  facts: AssistantToolFacts;
  provenance: AssistantToolProvenance;
  sensitivity: AssistantToolSensitivity;
  redactions: string[];
  truncation: AssistantToolTruncation;
  warnings: string[];
  audit: AssistantToolAudit;
}

export type AssistantToolInputSchema = z.ZodRawShape;
export type AssistantToolInput<TSchema extends AssistantToolInputSchema> = z.infer<z.ZodObject<TSchema>>;

/**
 * Typed read-only tool definition. The executor receives an already validated
 * input object and an adapter-provided context that owns authorization checks;
 * scope and sensitivity metadata are descriptive guardrails for UI, audit, and
 * model-planning adapters, not a substitute for executor authorization.
 */
export interface AssistantReadToolDefinition<
  TSchema extends AssistantToolInputSchema = AssistantToolInputSchema,
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: TSchema;
  outputSchema: z.ZodType<TData>;
  sensitivity: AssistantToolSensitivity;
  requiredScope: AssistantToolScope;
  budgets: AssistantToolBudget;
  execute(input: AssistantToolInput<TSchema>, context: AssistantToolContext): Promise<AssistantToolEnvelope<TData>>;
}

export class AssistantToolError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = -32000
  ) {
    super(message);
    this.name = 'AssistantToolError';
  }
}

export function createToolEnvelope<TData extends Record<string, unknown>>(input: {
  tool: Pick<AssistantReadToolDefinition, 'name' | 'sensitivity' | 'requiredScope'>;
  context: AssistantToolContext;
  data: TData;
  summary: string;
  facts?: AssistantToolFact[];
  provenanceSources: AssistantToolProvenance['sources'];
  redactions?: string[];
  truncation?: Partial<AssistantToolTruncation>;
  warnings?: string[];
  audit?: Partial<Pick<AssistantToolAudit, 'walletCount' | 'rowCount'>>;
}): AssistantToolEnvelope<TData> {
  return {
    data: input.data,
    facts: {
      summary: input.summary,
      items: input.facts ?? [],
    },
    provenance: {
      sources: input.provenanceSources,
      computedAt: new Date().toISOString(),
    },
    sensitivity: input.tool.sensitivity,
    redactions: input.redactions ?? [],
    truncation: {
      truncated: input.truncation?.truncated ?? false,
      ...input.truncation,
    },
    warnings: input.warnings ?? [],
    audit: {
      operation: input.tool.name,
      source: input.context.source,
      sensitivity: input.tool.sensitivity,
      scope: input.tool.requiredScope.kind,
      ...input.audit,
    },
  };
}

export function addToolDuration<TData extends Record<string, unknown>>(
  envelope: AssistantToolEnvelope<TData>,
  durationMs: number
): AssistantToolEnvelope<TData> {
  return {
    ...envelope,
    audit: {
      ...envelope.audit,
      durationMs,
    },
  };
}

export function toMcpStructuredContent<TData extends Record<string, unknown>>(
  envelope: AssistantToolEnvelope<TData>
): Record<string, unknown> {
  return {
    ...envelope.data,
    _sanctuary: {
      facts: envelope.facts,
      provenance: envelope.provenance,
      sensitivity: envelope.sensitivity,
      redactions: envelope.redactions,
      truncation: envelope.truncation,
      warnings: envelope.warnings,
      audit: envelope.audit,
    },
  };
}

import { z } from 'zod';
import type {
  AssistantReadToolDefinition,
  AssistantToolEnvelope,
  AssistantToolSensitivity,
} from '../tools';

export const CONSOLE_SCOPE_KIND_VALUES = ['general', 'wallet', 'wallet_set', 'object', 'admin'] as const;
export const CONSOLE_SENSITIVITY_VALUES = ['public', 'wallet', 'high', 'admin'] as const;
export const CONSOLE_TURN_STATE_VALUES = [
  'accepted',
  'planning',
  'executing_tools',
  'synthesizing',
  'completed',
  'failed',
  'canceled',
] as const;

export type ConsoleScopeKind = (typeof CONSOLE_SCOPE_KIND_VALUES)[number];
export type ConsoleSensitivity = (typeof CONSOLE_SENSITIVITY_VALUES)[number];
export type ConsoleTurnState = (typeof CONSOLE_TURN_STATE_VALUES)[number];

const UuidSchema = z.string().uuid();
export const ConsoleSensitivitySchema = z.enum(CONSOLE_SENSITIVITY_VALUES);

export const ConsoleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general') }).strict(),
  z.object({ kind: z.literal('wallet'), walletId: UuidSchema }).strict(),
  z.object({
    kind: z.literal('wallet_set'),
    walletIds: z.array(UuidSchema).min(1).max(25),
  }).strict(),
  z.object({
    kind: z.literal('object'),
    walletId: UuidSchema,
    objectType: z.enum(['transaction', 'utxo', 'address', 'label', 'policy', 'draft', 'insight']),
    objectId: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({ kind: z.literal('admin') }).strict(),
]);

export type ConsoleScope = z.infer<typeof ConsoleScopeSchema>;

const DEFAULT_CONSOLE_SCOPE: ConsoleScope = { kind: 'general' };

export const ConsoleToolCallSchema = z.object({
  name: z.string().trim().min(1).max(100),
  input: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().max(240).optional(),
}).strict();

export type ConsoleToolCall = z.infer<typeof ConsoleToolCallSchema>;

const OptionalIsoDateSchema = z.string().datetime().optional();

function booleanQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 1 ? booleanQueryValue(value[0]) : value;
  }
  if (typeof value === 'boolean' || value === undefined) return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}

const OptionalBooleanQuerySchema = z.preprocess(
  booleanQueryValue,
  z.boolean().optional()
);

const BooleanQueryDefaultFalseSchema = OptionalBooleanQuerySchema.transform(
  value => value ?? false
);

export const ConsoleCreateSessionBodySchema = z.preprocess(
  body => body === undefined ? {} : body,
  z.object({
    title: z.string().trim().min(1).max(120).optional(),
    scope: ConsoleScopeSchema.optional(),
    maxSensitivity: ConsoleSensitivitySchema.default('wallet'),
    expiresAt: OptionalIsoDateSchema,
  }).strict()
);

export const ConsoleRunTurnBodySchema = z.object({
  sessionId: UuidSchema.optional(),
  prompt: z.string().trim().min(1).max(12000),
  scope: ConsoleScopeSchema.optional(),
  maxSensitivity: ConsoleSensitivitySchema.default('wallet'),
  expiresAt: OptionalIsoDateSchema,
  toolCalls: z.array(ConsoleToolCallSchema).max(8).optional(),
}).strict();

export const ConsolePromptListQuerySchema = z.object({
  limit: z.coerce.number().int().catch(30).transform(value => Math.max(1, Math.min(value, 100))),
  offset: z.coerce.number().int().catch(0).transform(value => Math.max(0, value)),
  search: z.string().trim().max(300).optional(),
  saved: OptionalBooleanQuerySchema,
  includeExpired: BooleanQueryDefaultFalseSchema,
});

export const ConsolePromptUpdateBodySchema = z.object({
  saved: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export const ConsolePromptReplayBodySchema = z.preprocess(
  body => body === undefined ? {} : body,
  z.object({
    sessionId: UuidSchema.optional(),
    scope: ConsoleScopeSchema.optional(),
    maxSensitivity: ConsoleSensitivitySchema.optional(),
    expiresAt: OptionalIsoDateSchema,
  }).strict()
);

export function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseOptionalDate(value?: string | null): Date | null | undefined {
  if (value === null) return null;
  return value ? new Date(value) : undefined;
}

export function parseStoredConsoleScope(value: unknown): ConsoleScope {
  const parsed = ConsoleScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONSOLE_SCOPE;
}

export function parseStoredConsoleSensitivity(value: unknown): ConsoleSensitivity {
  const parsed = ConsoleSensitivitySchema.safeParse(value);
  return parsed.success ? parsed.data : 'wallet';
}

export function scopeWalletIds(scope: ConsoleScope): string[] {
  if (scope.kind === 'wallet') return [scope.walletId];
  if (scope.kind === 'wallet_set') return scope.walletIds;
  if (scope.kind === 'object') return [scope.walletId];
  return [];
}

export function scopeIncludesWallet(scope: ConsoleScope, walletId: string): boolean {
  if (scope.kind === 'wallet') return scope.walletId === walletId;
  if (scope.kind === 'wallet_set') return scope.walletIds.includes(walletId);
  if (scope.kind === 'object') return scope.walletId === walletId;
  return false;
}

export function sensitivityAllowed(
  requested: AssistantToolSensitivity,
  maxSensitivity: ConsoleSensitivity
): boolean {
  const rank: Record<ConsoleSensitivity, number> = { public: 0, wallet: 1, high: 2, admin: 3 };
  return rank[requested] <= rank[maxSensitivity];
}

export function describeToolForPlanning(definition: AssistantReadToolDefinition) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    sensitivity: definition.sensitivity,
    requiredScope: definition.requiredScope.kind,
    inputFields: Object.keys(definition.inputSchema),
  };
}

export function compactToolEnvelope(envelope: AssistantToolEnvelope) {
  return {
    facts: envelope.facts,
    provenance: envelope.provenance,
    sensitivity: envelope.sensitivity,
    redactions: envelope.redactions,
    truncation: envelope.truncation,
    warnings: envelope.warnings,
    audit: envelope.audit,
  };
}

export { DEFAULT_CONSOLE_SCOPE };

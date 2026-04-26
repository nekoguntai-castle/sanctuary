import { z, type ZodIssue } from "zod";

interface RequestWithBody {
  body?: unknown;
}

interface ResponseWithStatusJson {
  status: (code: number) => {
    json: (body: unknown) => unknown;
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatIssue(issue: ZodIssue): {
  path: string;
  message: string;
  code: string;
} {
  return {
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  };
}

const NonEmptyStringSchema = z.string().trim().min(1).max(1024);
const HttpUrlSchema = z.string().trim().max(2048).refine(isHttpUrl, {
  message: "Must be an HTTP(S) URL",
});
const OptionalAiEndpointSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === "" || isHttpUrl(value), {
    message: "Must be empty or an HTTP(S) URL",
  });

export const ConfigBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    endpoint: OptionalAiEndpointSchema.optional(),
    model: z.string().trim().max(200).optional(),
    providerProfileId: z.string().trim().max(100).optional(),
    providerType: z.string().trim().max(50).optional(),
    apiKey: z.string().max(8192).optional(),
  })
  .strict();

export type ConfigBody = z.infer<typeof ConfigBodySchema>;

export const SuggestLabelBodySchema = z
  .object({
    transactionId: NonEmptyStringSchema.max(200),
  })
  .strict();

export const QueryBodySchema = z
  .object({
    query: NonEmptyStringSchema.max(1000),
    walletId: NonEmptyStringSchema.max(200),
  })
  .strict();

export const DetectOllamaBodySchema = z
  .object({
    customEndpoints: z.array(HttpUrlSchema).max(10).optional(),
  })
  .strict();

export const ModelBodySchema = z
  .object({
    model: NonEmptyStringSchema.max(200),
  })
  .strict();

export const AnalysisTypeSchema = z.enum([
  "utxo_health",
  "fee_timing",
  "anomaly",
  "tax",
  "consolidation",
]);

export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;

const AnalysisContextSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const AnalyzeBodySchema = z
  .object({
    type: AnalysisTypeSchema,
    context: AnalysisContextSchema,
  })
  .strict();

const ChatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: NonEmptyStringSchema.max(8000),
  })
  .strict();

export const ChatBodySchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(50),
    walletContext: z.unknown().optional(),
  })
  .strict();

const ConsoleToolDescriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1000),
    sensitivity: z.string().trim().min(1).max(50),
    requiredScope: z.string().trim().min(1).max(50),
    inputFields: z.array(z.string().trim().min(1).max(100)).max(50),
  })
  .strict();

const ConsoleToolResultSchema = z
  .object({
    toolName: z.string().trim().min(1).max(100),
    status: z.enum(["completed", "denied", "failed"]),
    sensitivity: z.string().trim().max(50).optional(),
    facts: z.unknown().optional(),
    provenance: z.unknown().optional(),
    redactions: z.unknown().optional(),
    truncation: z.unknown().optional(),
    warnings: z.unknown().optional(),
    error: z.string().trim().max(500).optional(),
  })
  .strict();

export const ConsolePlanBodySchema = z
  .object({
    prompt: NonEmptyStringSchema.max(12000),
    scope: z.unknown().optional(),
    maxToolCalls: z.number().int().min(0).max(8).default(4),
    tools: z.array(ConsoleToolDescriptionSchema).min(1).max(80),
  })
  .strict();

export const ConsoleSynthesisBodySchema = z
  .object({
    prompt: NonEmptyStringSchema.max(12000),
    scope: z.unknown().optional(),
    toolResults: z.array(ConsoleToolResultSchema).max(8),
  })
  .strict();

export function parseRequestBody<TSchema extends z.ZodType>(
  schema: TSchema,
  req: RequestWithBody,
  res: ResponseWithStatusJson,
  error: string,
): z.infer<TSchema> | null {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) {
    return result.data;
  }

  res.status(400).json({
    error,
    details: result.error.issues.map(formatIssue),
  });
  return null;
}

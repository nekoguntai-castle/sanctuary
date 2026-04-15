import type { Request, Response } from 'express';
import { z, type ZodIssue } from 'zod';

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatIssue(issue: ZodIssue): { path: string; message: string; code: string } {
  return {
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  };
}

const NonEmptyStringSchema = z.string().trim().min(1).max(1024);
const HttpUrlSchema = z.string().trim().max(2048).refine(isHttpUrl, {
  message: 'Must be an HTTP(S) URL',
});
const OptionalAiEndpointSchema = z.string().trim().max(2048).refine((value) => value === '' || isHttpUrl(value), {
  message: 'Must be empty or an HTTP(S) URL',
});

export const ConfigBodySchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: OptionalAiEndpointSchema.optional(),
  model: z.string().trim().max(200).optional(),
}).strict();

export const SuggestLabelBodySchema = z.object({
  transactionId: NonEmptyStringSchema.max(200),
}).strict();

export const QueryBodySchema = z.object({
  query: NonEmptyStringSchema.max(1000),
  walletId: NonEmptyStringSchema.max(200),
}).strict();

export const DetectOllamaBodySchema = z.object({
  customEndpoints: z.array(HttpUrlSchema).max(10).optional(),
}).strict();

export const ModelBodySchema = z.object({
  model: NonEmptyStringSchema.max(200),
}).strict();

export const AnalysisTypeSchema = z.enum([
  'utxo_health',
  'fee_timing',
  'anomaly',
  'tax',
  'consolidation',
]);

export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;

const AnalysisContextSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const AnalyzeBodySchema = z.object({
  type: AnalysisTypeSchema,
  context: AnalysisContextSchema,
}).strict();

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: NonEmptyStringSchema.max(8000),
}).strict();

export const ChatBodySchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(50),
  walletContext: z.unknown().optional(),
}).strict();

export function parseRequestBody<TSchema extends z.ZodType>(
  schema: TSchema,
  req: Request,
  res: Response,
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

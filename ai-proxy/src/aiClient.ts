import { AI_REQUEST_TIMEOUT_MS } from "./constants";
import { createLogger } from "./logger";
import { extractErrorMessage, normalizeChatCompletionsUrl } from "./utils";
import { requireAllowedProviderEndpoint } from "./endpointPolicy";

const log = createLogger("AI");

export interface AiConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  providerProfileId?: string;
  providerType?: string;
  apiKey?: string;
}

export interface AiRequestOptions {
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  allowReasoningContent?: boolean;
}

export type AiRequestFailureReason =
  | "not_configured"
  | "endpoint_not_allowed"
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "request_failed";

export type AiRequestResult =
  | { ok: true; content: string }
  | {
      ok: false;
      reason: AiRequestFailureReason;
      message: string;
      status?: number;
    };

type ChatMessage = { role: string; content: string };
type AiRequestOptionsInput = number | AiRequestOptions | undefined;

interface NormalizedAiRequestOptions {
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  allowReasoningContent: boolean;
}

function numberOrDefault(
  value: number | undefined,
  defaultValue: number,
): number {
  return value === undefined ? defaultValue : value;
}

function booleanOrDefault(
  value: boolean | undefined,
  defaultValue: boolean,
): boolean {
  return value === undefined ? defaultValue : value;
}

export function buildProviderHeaders(
  aiConfig: AiConfig,
): Record<string, string> {
  // Ollama usually needs no auth; hosted OpenAI-compatible providers use bearer.
  return {
    "Content-Type": "application/json",
    ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {}),
  };
}

const normalizeRequestOptions = (
  options: AiRequestOptionsInput,
  defaults: NormalizedAiRequestOptions,
): NormalizedAiRequestOptions => {
  if (typeof options === "number") {
    return {
      timeoutMs: options,
      temperature: defaults.temperature,
      maxTokens: defaults.maxTokens,
      allowReasoningContent: defaults.allowReasoningContent,
    };
  }

  if (!options) return defaults;

  return {
    timeoutMs: numberOrDefault(options.timeoutMs, defaults.timeoutMs),
    temperature: numberOrDefault(options.temperature, defaults.temperature),
    maxTokens: numberOrDefault(options.maxTokens, defaults.maxTokens),
    allowReasoningContent: booleanOrDefault(
      options.allowReasoningContent,
      defaults.allowReasoningContent,
    ),
  };
};

const buildFailure = (
  reason: AiRequestFailureReason,
  message: string,
  status?: number,
): AiRequestResult => {
  return status === undefined
    ? { ok: false, reason, message }
    : { ok: false, reason, message, status };
};

const truncateErrorBody = (body: string): string => {
  return body.trim().replace(/\s+/g, " ").slice(0, 500);
};

const getTextValue = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const extractContentParts = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;

  const parts = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return getTextValue(record.text) ?? getTextValue(record.content) ?? "";
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n").trim() : null;
};

const extractResponseContent = (
  data: unknown,
  allowReasoningContent: boolean,
): string | null => {
  const choices = (
    data as {
      choices?: Array<{
        text?: unknown;
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
        };
      }>;
    }
  )?.choices;
  const choice = choices?.[0];
  const message = choice?.message;
  const content =
    getTextValue(message?.content) ??
    extractContentParts(message?.content) ??
    getTextValue(choice?.text);
  if (content) return content;

  if (!allowReasoningContent) return null;

  return (
    getTextValue(message?.reasoning_content) ??
    getTextValue(message?.reasoning) ??
    null
  );
};

const callChatCompletions = async (
  aiConfig: AiConfig,
  messages: ChatMessage[],
  options: NormalizedAiRequestOptions,
  logMessage: string,
): Promise<AiRequestResult> => {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return buildFailure(
      "not_configured",
      "AI endpoint or model is not configured",
    );
  }

  try {
    requireAllowedProviderEndpoint(aiConfig.endpoint);
  } catch (error) {
    const reason = extractErrorMessage(error);
    log.error("Provider endpoint rejected", { reason });
    return buildFailure(
      "endpoint_not_allowed",
      `AI endpoint rejected by proxy policy: ${reason}`,
    );
  }

  const endpoint = normalizeChatCompletionsUrl(aiConfig.endpoint);
  log.info(logMessage, {
    providerType: aiConfig.providerType ?? "unknown",
    credentialConfigured: Boolean(aiConfig.apiKey),
    maxTokens: options.maxTokens,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildProviderHeaders(aiConfig),
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const suffix = body ? `: ${truncateErrorBody(body)}` : "";
      log.error("External AI error", { status: response.status });
      return buildFailure(
        "http_error",
        `AI endpoint returned status ${response.status}${suffix}`,
        response.status,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      log.error("Invalid JSON response from external AI");
      return buildFailure(
        "invalid_response",
        "Invalid JSON response from AI endpoint",
      );
    }

    const content = extractResponseContent(data, options.allowReasoningContent);
    if (!content) {
      log.error("No message content in response");
      return buildFailure(
        "invalid_response",
        "AI endpoint response did not include message content",
      );
    }

    return { ok: true, content };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.error("Request timeout", { timeoutMs: options.timeoutMs });
      return buildFailure(
        "timeout",
        `AI endpoint request timed out after ${options.timeoutMs}ms`,
      );
    }

    const message = extractErrorMessage(error);
    log.error("Request failed", { error: message });
    return buildFailure(
      "request_failed",
      `AI endpoint request failed: ${message}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Call external AI endpoint.
 */
export async function callExternalAI(
  aiConfig: AiConfig,
  prompt: string,
  timeout = AI_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  const result = await callChatCompletions(
    aiConfig,
    [{ role: "user", content: prompt }],
    normalizeRequestOptions(timeout, {
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
      temperature: 0.7,
      maxTokens: 500,
      allowReasoningContent: false,
    }),
    "Calling external AI",
  );
  return result.ok ? result.content : null;
}

/**
 * Call external AI with multi-message support for analysis and chat.
 */
export async function callExternalAIWithMessagesResult(
  aiConfig: AiConfig,
  messages: ChatMessage[],
  options?: number | AiRequestOptions,
): Promise<AiRequestResult> {
  return callChatCompletions(
    aiConfig,
    messages,
    normalizeRequestOptions(options, {
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
      temperature: 0.7,
      maxTokens: 2000,
      allowReasoningContent: false,
    }),
    "Calling external AI (multi-message)",
  );
}

export async function callExternalAIWithMessages(
  aiConfig: AiConfig,
  messages: ChatMessage[],
  options?: number | AiRequestOptions,
): Promise<string | null> {
  const result = await callExternalAIWithMessagesResult(
    aiConfig,
    messages,
    options,
  );
  return result.ok ? result.content : null;
}

/**
 * Parse structured JSON from AI response, including markdown code blocks.
 */
export function parseStructuredResponse(
  raw: string,
): Record<string, unknown> | null {
  try {
    let jsonStr = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const cleanJson = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/\n\s*\n/g, "\n");

    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

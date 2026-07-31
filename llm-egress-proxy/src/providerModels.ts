import { buildProviderHeaders, type AiConfig } from "./aiClient";
import { requestProviderEndpoint } from "./providerHttpClient";
import { normalizeOllamaBaseUrl, normalizeOpenAIBaseUrl } from "./utils";

const PROVIDER_MODEL_LIST_TIMEOUT_MS = 5000;

export interface ListedModel {
  name: string;
  size: number;
  modifiedAt: string;
}

function isOpenAICompatibleProvider(aiConfig: AiConfig): boolean {
  return aiConfig.providerType === "openai-compatible";
}

function modifiedAtFromOpenAICreated(created: unknown): string {
  if (typeof created !== "number" || !Number.isFinite(created)) {
    return "";
  }
  return new Date(created * 1000).toISOString();
}

export function mapOpenAICompatibleModels(data: {
  data?: Array<{ id?: unknown; created?: unknown }>;
}): ListedModel[] {
  return (data.data ?? [])
    .filter(
      (model): model is { id: string; created?: unknown } =>
        typeof model.id === "string" && model.id.trim().length > 0,
    )
    .map((model) => ({
      name: model.id,
      size: 0,
      modifiedAt: modifiedAtFromOpenAICreated(model.created),
    }));
}

export async function listOpenAICompatibleModels(
  aiConfig: AiConfig,
  endpoint: string,
): Promise<ListedModel[]> {
  const baseUrl = normalizeOpenAIBaseUrl(endpoint);
  const response = await requestProviderEndpoint({
    url: `${baseUrl}/models`,
    headers: buildProviderHeaders(aiConfig),
    timeoutMs: PROVIDER_MODEL_LIST_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error("Failed to fetch models from OpenAI-compatible endpoint");
  }

  const data = parseModelResponse<{
    data?: Array<{ id?: unknown; created?: unknown }>;
  }>(response.body, "OpenAI-compatible");
  return mapOpenAICompatibleModels(data);
}

export async function listOllamaModels(
  endpoint: string,
  timeoutMs = PROVIDER_MODEL_LIST_TIMEOUT_MS,
): Promise<ListedModel[]> {
  const baseUrl = normalizeOllamaBaseUrl(endpoint);
  const response = await requestProviderEndpoint({
    url: `${baseUrl}/api/tags`,
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error("Failed to fetch models from Ollama endpoint");
  }

  const data = parseModelResponse<{
    models?: Array<{ name: string; size: number; modified_at: string }>;
  }>(response.body, "Ollama");
  return (
    data.models?.map((model) => ({
      name: model.name,
      size: model.size,
      modifiedAt: model.modified_at,
    })) || []
  );
}

function parseModelResponse<T>(body: Buffer, providerName: string): T {
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${providerName} endpoint`);
  }
}

export function listProviderModels(
  aiConfig: AiConfig,
  endpoint: string,
): Promise<ListedModel[]> {
  return isOpenAICompatibleProvider(aiConfig)
    ? listOpenAICompatibleModels(aiConfig, endpoint)
    : listOllamaModels(endpoint);
}

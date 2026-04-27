import { buildProviderHeaders, type AiConfig } from "./aiClient";
import { normalizeOllamaBaseUrl, normalizeOpenAIBaseUrl } from "./utils";

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
  const response = await fetch(`${baseUrl}/models`, {
    headers: buildProviderHeaders(aiConfig),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch models from OpenAI-compatible endpoint");
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: unknown; created?: unknown }>;
  };
  return mapOpenAICompatibleModels(data);
}

export async function listOllamaModels(
  endpoint: string,
): Promise<ListedModel[]> {
  const baseUrl = normalizeOllamaBaseUrl(endpoint);
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch models from Ollama endpoint");
  }

  const data = (await response.json()) as {
    models?: Array<{ name: string; size: number; modified_at: string }>;
  };
  return (
    data.models?.map((model) => ({
      name: model.name,
      size: model.size,
      modifiedAt: model.modified_at,
    })) || []
  );
}

export function listProviderModels(
  aiConfig: AiConfig,
  endpoint: string,
): Promise<ListedModel[]> {
  return isOpenAICompatibleProvider(aiConfig)
    ? listOpenAICompatibleModels(aiConfig, endpoint)
    : listOllamaModels(endpoint);
}

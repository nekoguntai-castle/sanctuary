import { ServiceUnavailableError } from '../../errors/ApiError';
import { getAIConfig, getContainerUrl, syncConfigToContainer } from '../../services/ai/config';
import { buildAIProxyJsonHeaders } from '../../services/ai/proxyClient';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { ConsoleScope, ConsoleToolCall } from './protocol';

const log = createLogger('ASSISTANT:CONSOLE_GATEWAY');
const AI_CONTAINER_URL = getContainerUrl();
const CONSOLE_GATEWAY_TIMEOUT_MS = 45_000;

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
  status: 'completed' | 'denied' | 'failed';
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

async function ensureConfiguredProvider(): Promise<ConsoleGatewayProviderState> {
  const config = await getAIConfig();
  if (!config.enabled || !config.endpoint || !config.model) {
    throw new ServiceUnavailableError('AI provider is not configured for Sanctuary Console');
  }
  const synced = await syncConfigToContainer(config);
  if (!synced) {
    throw new ServiceUnavailableError('AI provider configuration could not be synced for Sanctuary Console');
  }
  return {
    providerProfileId: config.providerProfileId,
    model: config.model,
  };
}

async function fetchConsoleGateway<TResponse>(
  path: '/console/plan' | '/console/synthesize',
  body: Record<string, unknown>
): Promise<TResponse> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}${path}`, {
      method: 'POST',
      headers: buildAIProxyJsonHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONSOLE_GATEWAY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new ServiceUnavailableError(`AI proxy ${path} request failed`, 'SERVICE_UNAVAILABLE', {
        status: response.status,
      });
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    log.error('Console AI proxy request failed', { path, error: getErrorMessage(error) });
    throw new ServiceUnavailableError('AI proxy is not available for Sanctuary Console');
  }
}

export async function planConsoleTools(input: {
  prompt: string;
  scope: ConsoleScope;
  maxToolCalls: number;
  tools: ConsoleGatewayToolDescription[];
}): Promise<ConsoleGatewayPlan & ConsoleGatewayProviderState> {
  const provider = await ensureConfiguredProvider();
  const plan = await fetchConsoleGateway<ConsoleGatewayPlan>('/console/plan', input);
  return { ...provider, toolCalls: plan.toolCalls ?? [], warnings: plan.warnings ?? [] };
}

export async function synthesizeConsoleAnswer(input: {
  prompt: string;
  scope: ConsoleScope;
  toolResults: ConsoleGatewayToolResult[];
}): Promise<{ response: string } & ConsoleGatewayProviderState> {
  const provider = await ensureConfiguredProvider();
  const result = await fetchConsoleGateway<{ response?: string }>('/console/synthesize', input);
  return {
    ...provider,
    response: typeof result.response === 'string' ? result.response : '',
  };
}

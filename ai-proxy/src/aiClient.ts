import { AI_REQUEST_TIMEOUT_MS } from './constants';
import { createLogger } from './logger';
import {
  extractErrorMessage,
  normalizeOllamaChatUrl,
} from './utils';

const log = createLogger('AI');

export interface AiConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

/**
 * Call external AI endpoint.
 */
export async function callExternalAI(
  aiConfig: AiConfig,
  prompt: string,
  timeout = AI_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return null;
  }

  try {
    const endpoint = normalizeOllamaChatUrl(aiConfig.endpoint);

    log.info('Calling external AI', { endpoint });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error('External AI error', { status: response.status });
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message: { content: string } }> };
    if (!data.choices || data.choices.length === 0) {
      log.error('No choices in response');
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('Request timeout');
    } else {
      log.error('Request failed', { error: extractErrorMessage(error) });
    }
    return null;
  }
}

/**
 * Call external AI with multi-message support for analysis and chat.
 */
export async function callExternalAIWithMessages(
  aiConfig: AiConfig,
  messages: Array<{ role: string; content: string }>,
  timeout = AI_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return null;
  }

  try {
    const endpoint = normalizeOllamaChatUrl(aiConfig.endpoint);
    log.info('Calling external AI (multi-message)', { endpoint });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error('External AI error', { status: response.status });
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message: { content: string } }> };
    if (!data.choices || data.choices.length === 0) {
      log.error('No choices in response');
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('Request timeout');
    } else {
      log.error('Request failed', { error: extractErrorMessage(error) });
    }
    return null;
  }
}

/**
 * Parse structured JSON from AI response, including markdown code blocks.
 */
export function parseStructuredResponse(raw: string): Record<string, unknown> | null {
  try {
    let jsonStr = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const cleanJson = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/\n\s*\n/g, '\n');

    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

/**
 * Telegram Bot API
 *
 * Low-level Telegram API communication with circuit breaker protection.
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { createCircuitBreaker, CircuitOpenError } from '../circuitBreaker';
import type {
  TelegramErrorResponse,
  TelegramGetUpdatesResponse,
  TelegramTransportResult,
} from './types';
import type { NotificationFailureClass } from '../notifications/outcomes';

const log = createLogger('TELEGRAM:SVC_API');

export const TELEGRAM_API = 'https://api.telegram.org/bot';
const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{35,}$/;

type TelegramDiagnosticFailureClass = Exclude<
  NotificationFailureClass,
  'redis_unavailable' | 'queue_add_failed' | 'internal'
>;

let lastTransportSuccessAt: number | null = null;
let lastTransportFailureAt: number | null = null;
let lastTransportFailureClass: TelegramDiagnosticFailureClass = 'none';

function diagnosticFailureClass(
  value: NotificationFailureClass,
): TelegramDiagnosticFailureClass {
  if (value === 'redis_unavailable' || value === 'queue_add_failed' || value === 'internal') {
    return 'other';
  }
  return value;
}

function recordTransportResult(result: TelegramTransportResult): TelegramTransportResult {
  if (result.success) {
    lastTransportSuccessAt = Date.now();
  } else {
    lastTransportFailureAt = Date.now();
    lastTransportFailureClass = diagnosticFailureClass(result.failureClass);
  }
  return result;
}

export function getTelegramTransportDiagnostics(): {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureClass: TelegramDiagnosticFailureClass;
} {
  return {
    lastSuccessAt: lastTransportSuccessAt,
    lastFailureAt: lastTransportFailureAt,
    lastFailureClass: lastTransportFailureClass,
  };
}

function buildTelegramApiUrl(botToken: string, method: 'sendMessage' | 'getUpdates'): string | null {
  if (!TELEGRAM_BOT_TOKEN_PATTERN.test(botToken)) {
    return null;
  }

  return new URL(`/bot${botToken}/${method}`, TELEGRAM_API_ORIGIN).toString();
}

// Circuit breaker: 5 failures -> open for 60s -> half-open probe
const telegramCircuit = createCircuitBreaker<{ success: boolean; chatId?: string; username?: string; error?: string }>({
  name: 'telegram',
  failureThreshold: 5,
  recoveryTimeout: 60_000,
});

class TelegramProviderError extends Error {
  constructor(
    message: string,
    readonly result: TelegramTransportResult,
  ) {
    super(message);
    this.name = 'TelegramProviderError';
  }
}

function rejectedResult(
  failureClass: TelegramTransportResult['failureClass'],
  error: string,
  retryable: boolean,
): TelegramTransportResult {
  return {
    success: false,
    outcome: 'rejected',
    failureClass,
    retryable,
    acknowledgement: 'not_accepted',
    error,
  };
}

function classifyHttpFailure(status: number): TelegramTransportResult['failureClass'] {
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}

function classifyThrownFailure(error: unknown): TelegramTransportResult['failureClass'] {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  return 'network';
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
): Promise<TelegramTransportResult> {
  const telegramUrl = buildTelegramApiUrl(botToken, 'sendMessage');
  if (!telegramUrl) {
    log.warn('Invalid Telegram bot token format');
    return recordTransportResult(
      rejectedResult('invalid_configuration', 'Invalid Telegram bot token', false),
    );
  }

  try {
    const result = await telegramCircuit.execute(async () => {
      const response = await fetch(
        telegramUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: false,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => {
          log.warn('Failed to parse Telegram sendMessage error response JSON');
          return {};
        }) as TelegramErrorResponse | Record<string, never>;
        const errorMsg =
          'description' in errorData ? errorData.description : `HTTP ${response.status}`;

        const failure = rejectedResult(
          classifyHttpFailure(response.status),
          errorMsg,
          response.status === 429 || response.status >= 500,
        );

        // 5xx = service outage, throw a typed error to trip the circuit breaker
        if (response.status >= 500) {
          throw new TelegramProviderError(`Telegram API error: ${errorMsg}`, failure);
        }

        // 4xx = client error (bad token, blocked, etc.), return without tripping circuit
        log.error(`Telegram API error: ${errorMsg}`);
        return failure;
      }

      return {
        success: true,
        outcome: 'accepted',
        failureClass: 'none',
        retryable: false,
        acknowledgement: 'accepted',
      };
    }) as TelegramTransportResult;
    return recordTransportResult(result);
  } catch (err) {
    if (err instanceof TelegramProviderError) {
      log.error(err.message);
      return recordTransportResult(err.result);
    }
    if (err instanceof CircuitOpenError) {
      log.warn(`Telegram circuit open, skipping send (retry in ${Math.ceil(err.retryAfter / 1000)}s)`);
      return recordTransportResult(
        rejectedResult(
          'circuit_open',
          'Telegram service unavailable, will retry shortly',
          true,
        ),
      );
    }
    const errorMsg = getErrorMessage(err, 'Unknown error');
    log.error(`Telegram send failed: ${errorMsg}`);
    return recordTransportResult({
      success: false,
      outcome: 'ambiguous',
      failureClass: classifyThrownFailure(err),
      retryable: true,
      acknowledgement: 'unknown',
      error: errorMsg,
    });
  }
}

/**
 * Get Chat ID from bot's recent messages
 * User must send /start or any message to the bot first
 */
export async function getChatIdFromBot(
  botToken: string
): Promise<{ success: boolean; chatId?: string; username?: string; error?: string }> {
  const telegramUrl = buildTelegramApiUrl(botToken, 'getUpdates');
  if (!telegramUrl) {
    log.warn('Invalid Telegram bot token format');
    return { success: false, error: 'Invalid Telegram bot token' };
  }

  try {
    return await telegramCircuit.execute(async () => {
      const url = new URL(telegramUrl);
      url.searchParams.set('limit', '10');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => {
          log.warn('Failed to parse Telegram getUpdates error response JSON');
          return {};
        }) as TelegramErrorResponse | Record<string, never>;
        const errorMsg =
          'description' in errorData ? errorData.description : `HTTP ${response.status}`;

        // 5xx = service outage, throw to trip circuit breaker
        if (response.status >= 500) {
          throw new Error(`Telegram API error: ${errorMsg}`);
        }

        // 4xx = client error, return without tripping circuit
        return { success: false, error: errorMsg };
      }

      const data = await response.json() as TelegramGetUpdatesResponse;
      const updates = data.result ?? [];

      if (updates.length === 0) {
        return {
          success: false,
          error: 'No messages found. Please send /start to your bot first.',
        };
      }

      // Get the most recent message's chat ID
      const latestUpdate = updates[updates.length - 1];
      const chat = latestUpdate?.message?.chat || latestUpdate?.my_chat_member?.chat;

      if (!chat?.id) {
        return {
          success: false,
          error: 'Could not extract chat ID from messages. Please send /start to your bot.',
        };
      }

      return {
        success: true,
        chatId: String(chat.id),
        username: chat.username || chat.first_name || undefined,
      };
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      log.warn(`Telegram circuit open, skipping getUpdates (retry in ${Math.ceil(err.retryAfter / 1000)}s)`);
      return { success: false, error: 'Telegram service unavailable, will retry shortly' };
    }
    const errorMsg = getErrorMessage(err, 'Unknown error');
    log.error(`Failed to get chat ID: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Test Telegram configuration by sending a test message
 */
export async function testTelegramConfig(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; error?: string }> {
  const testMessage =
    '🔔 <b>Sanctuary Test Message</b>\n\n' +
    'Your Telegram notifications are configured correctly!\n\n' +
    'You will receive notifications for wallet transactions based on your settings.';

  return sendTelegramMessage(botToken, chatId, testMessage);
}

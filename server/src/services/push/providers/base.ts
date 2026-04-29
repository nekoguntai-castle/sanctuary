/**
 * Base Push Provider
 *
 * Abstract base class implementing common push provider functionality.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type {
  IPushProvider,
  PushErrorCode,
  PushMessage,
  PushPlatform,
  PushResult,
} from '../types';

export interface BasePushProviderConfig {
  name: string;
  priority: number;
  platform: PushPlatform;
}

const log = createLogger('PUSH:SVC_PROVIDER');

function getThrownPushErrorCode(error: unknown): PushErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { errorCode?: unknown }).errorCode;
  return typeof code === 'string' ? (code as PushErrorCode) : undefined;
}

export abstract class BasePushProvider implements IPushProvider {
  readonly name: string;
  readonly priority: number;
  readonly platform: PushPlatform;

  constructor(config: BasePushProviderConfig) {
    this.name = config.name;
    this.priority = config.priority;
    this.platform = config.platform;
  }

  /**
   * Health check - verifies provider is configured
   */
  async healthCheck(): Promise<boolean> {
    return this.isConfigured();
  }

  /**
   * Check if the provider is properly configured
   */
  abstract isConfigured(): boolean;

  /**
   * Send push notification
   */
  async send(deviceToken: string, message: PushMessage): Promise<PushResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: `${this.name} provider not configured`,
        errorCode: 'provider_not_configured',
      };
    }

    try {
      return await this.sendNotification(deviceToken, message);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      log.error(`${this.name} send failed`, { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
        errorCode: getThrownPushErrorCode(error) ?? 'request_failed',
      };
    }
  }

  /**
   * Implement actual send logic in subclasses
   */
  protected abstract sendNotification(
    deviceToken: string,
    message: PushMessage,
  ): Promise<PushResult>;
}

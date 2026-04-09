/**
 * Apple Push Notification Service Provider
 *
 * Sends push notifications to iOS devices using token-based authentication.
 * Requires APNs credentials configured via environment variables.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { BasePushProvider } from './base';
import { createLogger } from '../../../utils/logger';
import { safeJsonParseUntyped } from '../../../utils/safeJson';
import { createCircuitBreaker, type CircuitBreaker } from '../../circuitBreaker';
import type { PushMessage, PushResult } from '../types';

const log = createLogger('PUSH:SVC_APNS');

const APNS_HOST_PRODUCTION = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

export class APNsPushProvider extends BasePushProvider {
  private cachedToken: { token: string; expires: number } | null = null;
  private cachedKeyContent: string | null = null;
  // Circuit breaker: 5 failures → open for 60s → half-open probe
  private apnsCircuit: CircuitBreaker<PushResult>;

  constructor() {
    super({
      name: 'apns',
      priority: 100,
      platform: 'ios',
    });

    this.apnsCircuit = createCircuitBreaker<PushResult>({
      name: 'apns',
      failureThreshold: 5,
      recoveryTimeout: 60_000,
    });

    // Eagerly load and cache the key file at construction time
    // to avoid blocking the event loop with fs.readFileSync during token generation
    this.loadKeyFile();
  }

  /**
   * Eagerly load APNs key file. Called once at construction.
   */
  private loadKeyFile(): void {
    const keyPath = process.env.APNS_KEY_PATH;
    if (!keyPath) return;

    try {
      this.cachedKeyContent = fs.readFileSync(keyPath, 'utf8');
      log.debug('APNs key file loaded and cached');
    } catch {
      log.debug('APNs key file not readable');
    }
  }

  /**
   * Check if APNs is configured with required credentials
   */
  isConfigured(): boolean {
    return !!(
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_KEY_PATH &&
      process.env.APNS_BUNDLE_ID
    );
  }

  /**
   * Generate a JWT token for APNs authentication
   * Tokens are cached and reused until near expiry
   */
  private getToken(): string {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const keyPath = process.env.APNS_KEY_PATH;

    if (!keyId || !teamId || !keyPath) {
      throw new Error('APNs not configured: missing APNS_KEY_ID, APNS_TEAM_ID, or APNS_KEY_PATH');
    }

    // Reuse token if not expired (tokens valid for 1 hour)
    if (this.cachedToken && Date.now() < this.cachedToken.expires) {
      return this.cachedToken.token;
    }

    const key = this.cachedKeyContent ?? fs.readFileSync(keyPath, 'utf8');
    const token = jwt.sign({}, key, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      expiresIn: '55m', // Refresh 5 min before expiry
    });

    this.cachedToken = {
      token,
      expires: Date.now() + 55 * 60 * 1000,
    };

    log.debug('Generated new APNs JWT token');
    return token;
  }

  /**
   * Send push notification to iOS device.
   * Wrapped in a circuit breaker — 5xx/network errors trip the circuit,
   * 4xx errors (invalid token, etc.) return failure without tripping.
   */
  protected async sendNotification(
    deviceToken: string,
    message: PushMessage
  ): Promise<PushResult> {
    const bundleId = process.env.APNS_BUNDLE_ID;
    const isProduction = process.env.APNS_PRODUCTION === 'true';

    if (!bundleId) {
      return {
        success: false,
        error: 'APNs not configured (missing APNS_BUNDLE_ID)',
      };
    }

    return this.apnsCircuit.execute(async () => {
      const host = isProduction ? APNS_HOST_PRODUCTION : APNS_HOST_SANDBOX;
      const url = `https://${host}/3/device/${deviceToken}`;

      const payload = {
        aps: {
          alert: {
            title: message.title,
            body: message.body,
          },
          sound: 'default',
          'mutable-content': 1,
        },
        // Include custom data at root level (APNs convention)
        ...message.data,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'authorization': `bearer ${this.getToken()}`,
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorJson = safeJsonParseUntyped<Record<string, unknown>>(errorBody, {}, 'APNs error response');

        const reason = (errorJson as { reason?: string }).reason || errorBody || `HTTP ${response.status}`;

        // 5xx = service outage, throw to trip circuit breaker
        if (response.status >= 500) {
          throw new Error(`APNs ${response.status}: ${reason}`);
        }

        // 4xx = client error (invalid token, etc.), return without tripping circuit
        return { success: false, error: `APNs ${response.status}: ${reason}` };
      }

      log.debug(`APNs notification sent to device ${deviceToken.slice(0, 8)}...`);
      return {
        success: true,
        messageId: response.headers.get('apns-id') || undefined,
      };
    });
  }
}

// Export legacy function for backward compatibility
export function isAPNsConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_PATH &&
    process.env.APNS_BUNDLE_ID
  );
}

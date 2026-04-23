/**
 * Firebase Cloud Messaging Provider
 *
 * Sends push notifications to Android devices using FCM HTTP v1 API.
 * Requires Firebase service account JSON configured via environment variable.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { BasePushProvider } from './base';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { safeJsonParseUntyped } from '../../../utils/safeJson';
import { createCircuitBreaker, type CircuitBreaker } from '../../circuitBreaker';
import type { PushMessage, PushResult } from '../types';

const log = createLogger('PUSH:SVC_FCM');

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const FCM_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function buildFcmSendUrl(projectId: string): string {
  const normalizedProjectId = projectId.trim();
  if (!FCM_PROJECT_ID_PATTERN.test(normalizedProjectId)) {
    throw new Error('FCM service account project_id is invalid');
  }

  return new URL(`/v1/projects/${normalizedProjectId}/messages:send`, 'https://fcm.googleapis.com').toString();
}

export class FCMPushProvider extends BasePushProvider {
  private accessToken: { token: string; expires: number } | null = null;
  private serviceAccountCache: ServiceAccount | null = null;
  private configuredCache: boolean | null = null;
  // Circuit breaker: 5 failures → open for 60s → half-open probe
  private fcmCircuit: CircuitBreaker<PushResult>;

  constructor() {
    super({
      name: 'fcm',
      priority: 100,
      platform: 'android',
    });

    this.fcmCircuit = createCircuitBreaker<PushResult>({
      name: 'fcm',
      failureThreshold: 5,
      recoveryTimeout: 60_000,
    });

    // Eagerly load and cache the service account at construction time
    // to avoid blocking the event loop with fs.readFileSync during notification sends
    this.loadServiceAccount();
  }

  /**
   * Eagerly load service account file. Called once at construction.
   */
  private loadServiceAccount(): void {
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
    if (!serviceAccountPath) {
      this.configuredCache = false;
      return;
    }

    try {
      const content = fs.readFileSync(serviceAccountPath, 'utf8');
      this.serviceAccountCache = safeJsonParseUntyped(content, null, 'FCM service account');
      this.configuredCache = this.serviceAccountCache !== null;
      if (this.configuredCache) {
        log.debug('FCM service account loaded and cached');
      }
    } catch (error) {
      log.debug('Failed to load FCM service account', { error: getErrorMessage(error) });
      this.configuredCache = false;
    }
  }

  /**
   * Check if FCM is configured with service account (uses cached result)
   */
  isConfigured(): boolean {
    return this.configuredCache === true;
  }

  /**
   * Get the cached service account JSON
   */
  private getServiceAccount(): ServiceAccount {
    if (this.serviceAccountCache) {
      return this.serviceAccountCache;
    }
    throw new Error('FCM not configured: missing or unreadable FCM_SERVICE_ACCOUNT');
  }

  /**
   * Get OAuth2 access token for FCM API
   * Tokens are cached and reused until near expiry
   */
  private async getAccessToken(): Promise<string> {
    // Reuse token if not expired
    if (this.accessToken && Date.now() < this.accessToken.expires) {
      return this.accessToken.token;
    }

    const serviceAccount = this.getServiceAccount();

    // Create JWT for OAuth2 token exchange
    const now = Math.floor(Date.now() / 1000);
    const jwtToken = jwt.sign(
      {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      serviceAccount.private_key,
      { algorithm: 'RS256' }
    );

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FCM OAuth failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = {
      token: data.access_token,
      // Refresh 60 seconds before expiry
      expires: Date.now() + (data.expires_in - 60) * 1000,
    };

    log.debug('Obtained new FCM access token');
    return this.accessToken.token;
  }

  /**
   * Send push notification to Android device.
   * Wrapped in a circuit breaker — 5xx/network errors trip the circuit,
   * 4xx errors (invalid token, etc.) return failure without tripping.
   */
  protected async sendNotification(
    deviceToken: string,
    message: PushMessage
  ): Promise<PushResult> {
    return this.fcmCircuit.execute(async () => {
      const serviceAccount = this.getServiceAccount();
      const url = buildFcmSendUrl(serviceAccount.project_id);

      const payload = {
        message: {
          token: deviceToken,
          notification: {
            title: message.title,
            body: message.body,
          },
          data: message.data || {},
          android: {
            priority: 'high' as const,
            notification: {
              sound: 'default',
              channelId: 'transactions',
            },
          },
        },
      };

      // getAccessToken() may throw on OAuth errors → trips circuit (appropriate)
      const accessToken = await this.getAccessToken();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorJson = safeJsonParseUntyped<Record<string, unknown>>(errorBody, {}, 'FCM error response');

        const errorMsg = (errorJson as { error?: { message?: string } }).error?.message ||
                         errorBody ||
                         `HTTP ${response.status}`;

        // 5xx = service outage, throw to trip circuit breaker
        if (response.status >= 500) {
          throw new Error(`FCM ${response.status}: ${errorMsg}`);
        }

        // 4xx = client error (invalid token, etc.), return without tripping circuit
        return { success: false, error: `FCM ${response.status}: ${errorMsg}` };
      }

      const result = await response.json() as { name: string };
      log.debug(`FCM notification sent to device ${deviceToken.slice(0, 8)}...`);
      return {
        success: true,
        messageId: result.name,
      };
    });
  }
}

// Cache for legacy function — checked once per process
let _fcmConfiguredCache: boolean | null = null;

// Export legacy function for backward compatibility
export function isFCMConfigured(): boolean {
  if (_fcmConfiguredCache !== null) return _fcmConfiguredCache;

  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
  if (!serviceAccountPath) {
    _fcmConfiguredCache = false;
    return false;
  }

  try {
    fs.accessSync(serviceAccountPath, fs.constants.R_OK);
    _fcmConfiguredCache = true;
    return true;
  } catch (error) {
    log.debug('FCM service account not accessible', { error: getErrorMessage(error) });
    _fcmConfiguredCache = false;
    return false;
  }
}

/** Reset the isFCMConfigured cache (for testing only) */
export function _resetFCMConfiguredCache(): void {
  _fcmConfiguredCache = null;
}

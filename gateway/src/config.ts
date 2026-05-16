/**
 * Gateway Configuration
 *
 * All configuration is loaded from environment variables.
 * This module exports a typed config object for use throughout the gateway.
 *
 * ## Required Environment Variables
 *
 * - `JWT_SECRET` - Must match the backend's JWT secret for token validation
 * - `GATEWAY_SECRET` - Shared secret for HMAC-based gateway authentication
 *
 * ## Optional Environment Variables
 *
 * ### Server
 * - `PORT` - Port to listen on inside the container (default: 4000)
 * - `GATEWAY_PORT` - Backward-compatible listener port alias when `PORT` is unset
 * - `NODE_ENV` - Environment mode (default: development)
 *
 * ### TLS/HTTPS
 * - `TLS_ENABLED` - Enable HTTPS (default: false, set to 'true' to enable)
 * - `TLS_CERT_PATH` - Path to certificate file (fullchain.pem)
 * - `TLS_KEY_PATH` - Path to private key file (privkey.pem)
 * - `TLS_CA_PATH` - Path to CA certificate chain file (optional, for intermediate certs)
 * - `TLS_MIN_VERSION` - Minimum TLS version (default: TLSv1.2)
 * - `GATEWAY_ALLOW_INSECURE_PRODUCTION_HTTP` - Explicit internal-only override for production HTTP
 *
 * ### Backend Connection
 * - `BACKEND_URL` - Backend HTTP URL (default: http://backend:3001)
 * - `BACKEND_WS_URL` - Backend WebSocket URL (default: ws://backend:3001)
 *
 * ### Rate Limiting
 * - `RATE_LIMIT_WINDOW_MS` - Time window in ms (default: 60000 = 1 minute)
 * - `RATE_LIMIT_MAX` - Max requests per window (default: 60)
 * - `RATE_LIMIT_MAX_REQUESTS` - Backward-compatible alias for `RATE_LIMIT_MAX`
 * - Exponential backoff: retry-after doubles with each violation (60s → 120s → 240s → max 3600s)
 *
 * ### CORS
 * - `CORS_ALLOWED_ORIGINS` - Comma-separated list of allowed browser origins
 *   (default: native/no-origin requests plus loopback development origins)
 *
 * ### Push Notifications
 * - `FCM_SERVICE_ACCOUNT_PATH` - Firebase service account JSON path
 *   (default: /app/config/fcm-service-account.json)
 * - `FCM_PROJECT_ID`, `FCM_PRIVATE_KEY`, `FCM_CLIENT_EMAIL` - Optional FCM env overrides
 * - `APNS_PRIVATE_KEY_PATH` - APNs `.p8` key path (default: /app/config/apns-key.p8)
 * - `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` - Optional APNs env config
 * - `APNS_PRODUCTION` - Use Apple's production APNs endpoint (default: false)
 */

import {
  getApnsPrivateKey,
  getCorsAllowedOrigins,
  getFcmConfig,
  getGatewayPort,
  getGatewayRateLimitMax,
  parseBooleanEnv,
} from './config/env';
import { exitNow } from './utils/processExit';

export const config = {
  // Server
  port: parseInt(getGatewayPort(), 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // TLS/HTTPS configuration
  tls: {
    enabled: process.env.TLS_ENABLED === 'true',
    certPath: process.env.TLS_CERT_PATH || '/app/config/ssl/fullchain.pem',
    keyPath: process.env.TLS_KEY_PATH || '/app/config/ssl/privkey.pem',
    caPath: process.env.TLS_CA_PATH || '', // Optional CA certificate chain
    minVersion: (process.env.TLS_MIN_VERSION || 'TLSv1.2') as 'TLSv1.2' | 'TLSv1.3',
    allowInsecureProductionHttp: process.env.GATEWAY_ALLOW_INSECURE_PRODUCTION_HTTP === 'true',
  },

  // Backend connection (internal network)
  backendUrl: process.env.BACKEND_URL || 'http://backend:3001',
  backendWsUrl: process.env.BACKEND_WS_URL || 'ws://backend:3001',
  backendRequestTimeoutMs: 5000,

  // JWT (must match backend)
  jwtSecret: process.env.JWT_SECRET || '',

  // Gateway secret for HMAC-based authentication with backend
  gatewaySecret: process.env.GATEWAY_SECRET || '',

  // CORS configuration (SEC-004)
  corsAllowedOrigins: getCorsAllowedOrigins(),

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
    maxRequests: parseInt(getGatewayRateLimitMax(), 10), // 60 requests per minute
    // Exponential backoff settings
    backoff: {
      baseRetryAfter: 60, // Start with 1 minute
      maxRetryAfter: 3600, // Max 1 hour
      multiplier: 2, // Double each time
    },
  },

  // Firebase Cloud Messaging (Android)
  // To enable: Create a Firebase project, download the service account JSON,
  // and either mount it at /app/config/fcm-service-account.json or set FCM_* env overrides.
  fcm: getFcmConfig(),

  // Apple Push Notification Service (iOS)
  // To enable: Create an APNs key in Apple Developer portal, download the .p8 file,
  // and mount it at /app/config/apns-key.p8. APNS_PRIVATE_KEY can override the file.
  apns: {
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    privateKey: getApnsPrivateKey(),
    bundleId: process.env.APNS_BUNDLE_ID || 'com.sanctuary.app',
    production: parseBooleanEnv(process.env.APNS_PRODUCTION, false),
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate required config
export function validateConfig(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.jwtSecret) {
    errors.push('JWT_SECRET is required');
  }

  if (!config.gatewaySecret) {
    warnings.push('GATEWAY_SECRET is not set - internal gateway calls will be rejected by the backend');
  } else if (config.gatewaySecret.length < 32) {
    warnings.push('GATEWAY_SECRET is shorter than 32 characters');
  }

  // TLS validation
  if (config.tls.enabled) {
    // Certificate files are validated at startup in index.ts
    // Here we just check the paths are configured
    if (!config.tls.certPath) {
      errors.push('TLS_CERT_PATH is required when TLS is enabled');
    }
    if (!config.tls.keyPath) {
      errors.push('TLS_KEY_PATH is required when TLS is enabled');
    }
  } else if (config.nodeEnv === 'production') {
    if (config.tls.allowInsecureProductionHttp) {
      warnings.push(
        'TLS is disabled in production because GATEWAY_ALLOW_INSECURE_PRODUCTION_HTTP=true; bind this gateway only to a trusted internal network'
      );
    } else {
      errors.push(
        'TLS is required in production. Set TLS_ENABLED=true or set GATEWAY_ALLOW_INSECURE_PRODUCTION_HTTP=true only for an internal-only deployment.'
      );
    }
  }

  if (warnings.length > 0) {
    console.warn('Configuration warnings:');
    warnings.forEach((warn) => console.warn(`  - ${warn}`));
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((err) => console.error(`  - ${err}`));
    exitNow(1);
  }
}

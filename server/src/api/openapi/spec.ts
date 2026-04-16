/**
 * OpenAPI Specification Assembly
 *
 * Assembles the complete OpenAPI 3.0 specification from modular
 * path and schema definitions.
 */

// Schemas
import { commonSchemas } from './schemas/common';
import { authSchemas } from './schemas/auth';
import { walletSchemas } from './schemas/wallet';
import { deviceSchemas } from './schemas/device';
import { syncSchemas, bitcoinSchemas, priceSchemas } from './schemas/bitcoin';
import { transactionSchemas } from './schemas/transactions';
import { pushSchemas } from './schemas/push';
import { mobilePermissionSchemas } from './schemas/mobilePermissions';
import { labelSchemas } from './schemas/labels';
import { draftSchemas } from './schemas/drafts';
import { payjoinSchemas } from './schemas/payjoin';
import { transferSchemas } from './schemas/transfers';
import { intelligenceSchemas } from './schemas/intelligence';
import { aiSchemas } from './schemas/ai';
import { agentSchemas } from './schemas/agent';
import { adminSchemas } from './schemas/admin';
import { healthSchemas } from './schemas/health';
import { internalSchemas } from './schemas/internal';

// Paths
import { authPaths } from './paths/auth';
import { walletPaths } from './paths/wallets';
import { walletSharingPaths } from './paths/walletSharing';
import { walletImportPaths } from './paths/walletImport';
import { walletHelperPaths } from './paths/walletHelpers';
import { walletExportPaths } from './paths/walletExport';
import { walletSettingsPaths } from './paths/walletSettings';
import { walletPolicyPaths } from './paths/walletPolicies';
import { devicePaths } from './paths/devices';
import { syncPaths, bitcoinPaths, pricePaths } from './paths/bitcoin';
import { transactionPaths } from './paths/transactions';
import { pushPaths } from './paths/push';
import { mobilePermissionPaths } from './paths/mobilePermissions';
import { labelPaths } from './paths/labels';
import { draftPaths } from './paths/drafts';
import { payjoinPaths } from './paths/payjoin';
import { transferPaths } from './paths/transfers';
import { intelligencePaths } from './paths/intelligence';
import { aiPaths } from './paths/ai';
import { agentPaths } from './paths/agent';
import { adminPaths } from './paths/admin';
import { healthPaths } from './paths/health';
import { internalPaths } from './paths/internal';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Sanctuary API',
    description: 'Bitcoin wallet management API for Sanctuary',
    version: '1.0.0',
    contact: {
      name: 'Sanctuary Team',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and authorization' },
    { name: 'Wallets', description: 'Wallet management' },
    { name: 'Devices', description: 'Hardware device management' },
    { name: 'Transactions', description: 'Transaction operations' },
    { name: 'Drafts', description: 'Transaction drafts (PSBT)' },
    { name: 'Labels', description: 'Wallet labels' },
    { name: 'Sync', description: 'Wallet synchronization' },
    { name: 'Bitcoin', description: 'Bitcoin network operations' },
    { name: 'Node', description: 'Bitcoin node connectivity checks' },
    { name: 'Price', description: 'Price information' },
    { name: 'Push', description: 'Mobile push device registration' },
    { name: 'Mobile Permissions', description: 'Mobile wallet permission restrictions' },
    { name: 'Payjoin', description: 'BIP78 Payjoin sender and receiver operations' },
    { name: 'Transfers', description: 'Wallet and device ownership transfers' },
    { name: 'Intelligence', description: 'Treasury Intelligence insights and conversations' },
    { name: 'AI', description: 'AI assistant features and model management' },
    { name: 'Agent', description: 'Scoped agent wallet operations' },
    { name: 'Admin', description: 'Administrative operations' },
    { name: 'Health', description: 'Health, readiness, and circuit breaker status' },
    { name: 'Internal', description: 'Root-mounted gateway and AI container contracts' },
  ],
  paths: {
    ...healthPaths,
    ...authPaths,
    ...walletPaths,
    ...walletSharingPaths,
    ...walletImportPaths,
    ...walletHelperPaths,
    ...walletExportPaths,
    ...walletSettingsPaths,
    ...walletPolicyPaths,
    ...devicePaths,
    ...syncPaths,
    ...bitcoinPaths,
    ...pricePaths,
    ...transactionPaths,
    ...labelPaths,
    ...draftPaths,
    ...pushPaths,
    ...mobilePermissionPaths,
    ...payjoinPaths,
    ...transferPaths,
    ...intelligencePaths,
    ...aiPaths,
    ...agentPaths,
    ...adminPaths,
    ...internalPaths,
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sanctuary_access',
        description:
          'ADR 0001 — Browser auth via HttpOnly Secure SameSite=Strict cookie set on login/2FA-verify/refresh. Used by the web frontend. Mobile and gateway callers use bearerAuth instead.',
      },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description:
          'ADR 0001 — Double-submit CSRF token echoed from the sanctuary_csrf cookie. Required on state-changing requests (POST/PUT/PATCH/DELETE) when the request authenticates via the sanctuary_access cookie. Requests authenticating via bearerAuth are exempt because cross-site requests cannot attach a custom Authorization header without explicit cross-origin opt-in.',
      },
      gatewaySignature: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Gateway-Signature',
        description: 'SEC-002 HMAC-SHA256 signature over method, full path, timestamp, and body hash.',
      },
      gatewayTimestamp: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Gateway-Timestamp',
        description: 'Unix millisecond timestamp accepted within the gateway replay window.',
      },
      agentBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'agt_ API key',
        description: 'Scoped agent API key for non-human funding-draft submission.',
      },
    },
    schemas: {
      ...commonSchemas,
      ...authSchemas,
      ...walletSchemas,
      ...deviceSchemas,
      ...syncSchemas,
      ...bitcoinSchemas,
      ...priceSchemas,
      ...transactionSchemas,
      ...labelSchemas,
      ...draftSchemas,
      ...pushSchemas,
      ...mobilePermissionSchemas,
      ...payjoinSchemas,
      ...transferSchemas,
      ...intelligenceSchemas,
      ...aiSchemas,
      ...agentSchemas,
      ...adminSchemas,
      ...healthSchemas,
      ...internalSchemas,
    },
  },
};

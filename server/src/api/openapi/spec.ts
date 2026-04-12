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

// Paths
import { authPaths } from './paths/auth';
import { walletPaths } from './paths/wallets';
import { walletSharingPaths } from './paths/walletSharing';
import { walletImportPaths } from './paths/walletImport';
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
    { name: 'Price', description: 'Price information' },
    { name: 'Push', description: 'Mobile push device registration' },
    { name: 'Mobile Permissions', description: 'Mobile wallet permission restrictions' },
    { name: 'Payjoin', description: 'BIP78 Payjoin sender and receiver operations' },
    { name: 'Transfers', description: 'Wallet and device ownership transfers' },
    { name: 'Intelligence', description: 'Treasury Intelligence insights and conversations' },
    { name: 'AI', description: 'AI assistant features and model management' },
    { name: 'Admin', description: 'Administrative operations' },
  ],
  paths: {
    ...authPaths,
    ...walletPaths,
    ...walletSharingPaths,
    ...walletImportPaths,
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
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
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
    },
  },
};

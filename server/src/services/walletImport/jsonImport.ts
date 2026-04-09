/**
 * Wallet Import - JSON Import
 *
 * Handles importing wallets from JSON configuration files
 * (custom Sanctuary JSON format with Zod schema validation).
 */

import type { JsonImportConfig, Network } from '../bitcoin/descriptorParser';
import { parseJsonImport } from '../bitcoin/descriptorParser';
import { resolveDevices } from './deviceResolution';
import { createWalletTransaction } from './walletImportService';
import { createLogger } from '../../utils/logger';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import type { ImportWalletResult } from './types';

const log = createLogger('WALLET_IMPORT:JSON');

/**
 * Import wallet from JSON configuration
 */
export async function importFromJson(
  userId: string,
  input: {
    json: string;
    name: string;
    network?: Network;
  }
): Promise<ImportWalletResult> {
  // Parse and validate JSON with Zod schema
  const { JsonImportConfigSchema } = await import('../import/schemas');
  const parsedJson = safeJsonParseUntyped<unknown>(input.json, null, 'wallet import JSON');
  if (parsedJson === null) {
    throw new Error('Invalid JSON format in wallet import data');
  }
  const parseResult = JsonImportConfigSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    throw new Error(parseResult.error.issues[0].message);
  }
  const jsonConfig = parseResult.data as JsonImportConfig;
  const parsed = parseJsonImport(jsonConfig);
  const network = input.network || parsed.network;

  // Resolve devices with original labels/types from JSON
  const resolutions = await resolveDevices(
    userId,
    parsed.devices,
    jsonConfig.devices
  );

  // Create devices and wallet in a transaction
  return createWalletTransaction(userId, {
    parsed,
    resolutions,
    name: input.name,
    network,
    jsonConfig,
  });
}

/**
 * JSON Import Parser
 *
 * Parses and validates JSON import configurations and wallet export formats.
 */

import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import { JsonImportConfigSchema, WalletExportDetectionSchema } from '../../import/schemas';
import { detectNetwork } from './descriptorUtils';
import type {
  ParsedDevice,
  ParsedDescriptor,
  DescriptorParseError,
  JsonImportConfig,
  WalletExportFormat,
} from './types';

/**
 * Validate JSON import configuration
 * Delegates to Zod schema for consistent validation.
 */
export function validateJsonImport(config: unknown): DescriptorParseError | null {
  const result = JsonImportConfigSchema.safeParse(config);
  if (!result.success) {
    // Return the first error message for backwards compatibility
    const firstIssue = result.error.issues[0];
    return { message: firstIssue.message };
  }
  return null;
}

/**
 * Parse JSON import config into standard format
 */
export function parseJsonImport(config: JsonImportConfig): ParsedDescriptor {
  const error = validateJsonImport(config);
  if (error) {
    throw new Error(error.message);
  }

  const devices: ParsedDevice[] = config.devices.map((d) => ({
    fingerprint: d.fingerprint.toLowerCase(),
    xpub: d.xpub,
    derivationPath: normalizeDerivationPath(d.derivationPath),
  }));

  // Detect network from first device if not specified
  const network = config.network || detectNetwork(devices[0].xpub, devices[0].derivationPath);

  const result: ParsedDescriptor = {
    type: config.type,
    scriptType: config.scriptType,
    devices,
    network,
    isChange: false,
  };

  if (config.type === 'multi_sig') {
    result.quorum = config.quorum;
    result.totalSigners = devices.length;
  }

  return result;
}

/**
 * Check if JSON is a wallet export format (has descriptor field)
 * Delegates to Zod schema for consistent validation.
 */
export function isWalletExportFormat(obj: unknown): obj is WalletExportFormat {
  return WalletExportDetectionSchema.safeParse(obj).success;
}

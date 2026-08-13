/**
 * Import Format Registry
 *
 * Central registry for all import format handlers.
 * Handlers are registered in priority order (highest first).
 *
 * Usage:
 *   import { importFormatRegistry, parseImportInput } from './import';
 *
 *   // Use parseImportInput for compatibility with existing code
 *   const result = parseImportInput(inputString);
 *
 *   // Or use registry directly
 *   const handler = importFormatRegistry.detect(inputString);
 *   if (handler) {
 *     const result = handler.parse(inputString);
 *   }
 *
 * Adding new formats:
 *   1. Create handler in handlers/ directory implementing ImportFormatHandler
 *   2. Import and register below with appropriate priority
 */

import { importFormatRegistry } from './registry';
import type { ParsedDescriptor } from './types';
import type { JsonImportDevice, ScriptType } from '../bitcoin/descriptorParser';

// Import handlers
import { coldcardHandler } from './handlers/coldcard';
import { walletExportHandler } from './handlers/walletExport';
import { bluewalletHandler } from './handlers/bluewallet';
import { jsonConfigHandler } from './handlers/jsonConfig';
import { descriptorHandler } from './handlers/descriptor';

/**
 * Signer identities accepted by each registered wallet-import handler. The
 * generated inventory checks this against the registry calls below so a new
 * handler cannot silently become a funds-controlling path.
 */
export const IMPORT_HANDLER_SIGNER_SURFACES = [
  { registration: 'coldcardHandler', handlerId: 'coldcard', vendors: ['coldcard'] },
  { registration: 'walletExportHandler', handlerId: 'wallet_export', vendors: ['generic', 'specter'] },
  { registration: 'bluewalletHandler', handlerId: 'bluewallet_text', vendors: ['coldcard', 'generic'] },
  { registration: 'jsonConfigHandler', handlerId: 'json', vendors: ['generic'] },
  { registration: 'descriptorHandler', handlerId: 'descriptor', vendors: ['generic'] },
] as const;

// Register handlers in priority order (done automatically by priority field)
// Higher priority = checked first
importFormatRegistry.register(coldcardHandler); // 85 - Coldcard JSON
importFormatRegistry.register(walletExportHandler); // 80 - Sparrow/Specter exports
importFormatRegistry.register(bluewalletHandler); // 75 - BlueWallet text
importFormatRegistry.register(jsonConfigHandler); // 60 - Custom JSON config
importFormatRegistry.register(descriptorHandler); // 10 - Plain descriptor (fallback)

/**
 * Parse import result compatible with existing walletImport.ts interface
 */
export interface ParseImportInputResult {
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text' | 'coldcard';
  parsed: ParsedDescriptor;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
  availablePaths?: Array<{ scriptType: ScriptType; path: string }>;
}

/**
 * Map handler IDs to legacy format names
 */
const formatIdMap: Record<string, ParseImportInputResult['format']> = {
  descriptor: 'descriptor',
  json: 'json',
  wallet_export: 'wallet_export',
  bluewallet_text: 'bluewallet_text',
  coldcard: 'coldcard',
};

/**
 * Parse import input using the registry
 *
 * Provides backward compatibility with the existing parseImportInput interface.
 * Auto-detects format and returns parsed result.
 */
export function parseImportInput(input: string): ParseImportInputResult {
  const result = importFormatRegistry.parse(input);

  // Map the format ID to the legacy format name
  const format = formatIdMap[result.format] || 'descriptor';

  return {
    format,
    parsed: result.parsed,
    originalDevices: result.originalDevices,
    suggestedName: result.suggestedName,
    availablePaths: result.availablePaths,
  };
}

// Export the registry and types
export { importFormatRegistry } from './registry';
export type {
  ImportFormatHandler,
  FormatDetectionResult,
  ImportParseResult,
  ImportValidationResult,
  ParsedDescriptor,
  ParsedDevice,
} from './types';

// Export individual handlers for direct use if needed
export { coldcardHandler } from './handlers/coldcard';
export { walletExportHandler } from './handlers/walletExport';
export { bluewalletHandler } from './handlers/bluewallet';
export { jsonConfigHandler } from './handlers/jsonConfig';
export { descriptorHandler } from './handlers/descriptor';

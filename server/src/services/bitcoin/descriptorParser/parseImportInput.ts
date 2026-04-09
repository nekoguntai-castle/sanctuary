/**
 * Import Input Parser (Orchestrator)
 *
 * Detects the format of import input (descriptor, JSON, BlueWallet text, Coldcard)
 * and dispatches to the appropriate parser.
 */

import { createLogger } from '../../../utils/logger';
import { safeJsonParseUntyped } from '../../../utils/safeJson';
import { parseDescriptorForImport, extractDescriptorFromText, isDescriptorTextFormat } from './descriptorParser';
import { parseJsonImport, isWalletExportFormat } from './jsonParser';
import { isColdcardExportFormat, parseColdcardExport } from './coldcardParser';
import { isBlueWalletTextFormat, parseBlueWalletText, parseBlueWalletTextImport } from './bluewalletParser';
import type { ParsedDescriptor, ScriptType, JsonImportConfig, JsonImportDevice } from './types';

const log = createLogger('BITCOIN:SVC_DESCRIPTOR');

/**
 * Attempt to parse input as descriptor, JSON, or BlueWallet text format
 * Returns the parsed result or throws an error
 */
export function parseImportInput(input: string): {
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text' | 'coldcard';
  parsed: ParsedDescriptor;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
  availablePaths?: Array<{ scriptType: ScriptType; path: string }>;
} {
  const trimmed = input.trim();
  log.debug('parseImportInput called', { inputLength: trimmed.length, startsWithHash: trimmed.startsWith('#'), first50: trimmed.substring(0, 50) });

  // Try to detect if it's JSON
  if (trimmed.startsWith('{')) {
    const json = safeJsonParseUntyped<Record<string, unknown> | null>(trimmed, null, 'import input');
    if (json === null) {
      throw new Error('Invalid JSON format');
    }

    // Check if it's a wallet export format (has descriptor field)
    if (isWalletExportFormat(json)) {
      const parsed = parseDescriptorForImport(json.descriptor as string);
      return {
        format: 'wallet_export',
        parsed,
        suggestedName: (json.label || json.name) as string | undefined,
      };
    }

    // Check if it's a Coldcard JSON export (has xfp and bip paths)
    if (isColdcardExportFormat(json)) {
      const { parsed, availablePaths } = parseColdcardExport(json);
      return {
        format: 'coldcard',
        parsed,
        availablePaths,
      };
    }

    // Otherwise treat as our JSON config format
    const config = json as unknown as JsonImportConfig;
    return {
      format: 'json',
      parsed: parseJsonImport(config),
      originalDevices: config.devices,
    };
  }

  // Check if it's BlueWallet/Coldcard text format (has Policy: M of N)
  if (isBlueWalletTextFormat(trimmed)) {
    const blueWalletParsed = parseBlueWalletText(trimmed);
    return {
      format: 'bluewallet_text',
      parsed: parseBlueWalletTextImport(trimmed),
      suggestedName: blueWalletParsed.name,
    };
  }

  // Check if it's a text file with descriptors and comments (e.g., Sparrow export)
  const isTextFormat = isDescriptorTextFormat(trimmed);
  log.debug('Checking text format', { isTextFormat });
  if (isTextFormat) {
    const descriptor = extractDescriptorFromText(trimmed);
    log.debug('Extracted descriptor from text', { descriptor: descriptor?.substring(0, 100) });
    return {
      format: 'descriptor',
      parsed: parseDescriptorForImport(descriptor!),
    };
  }

  // Try as plain descriptor
  log.debug('Trying as plain descriptor', { first100: trimmed.substring(0, 100) });
  return {
    format: 'descriptor',
    parsed: parseDescriptorForImport(trimmed),
  };
}

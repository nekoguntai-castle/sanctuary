/**
 * Device Parser Registry
 *
 * Central registry for all device import format parsers.
 * Parsers are registered in priority order (highest first).
 *
 * Usage:
 *   import { deviceParserRegistry, parseDeviceData } from './deviceParsers';
 *
 *   // Parse JSON object or string
 *   const result = parseDeviceData(jsonData);
 *   if (result) {
 *     console.log(result.xpub, result.fingerprint, result.derivationPath);
 *   }
 *
 *   // Or use registry directly for more control
 *   const parser = deviceParserRegistry.detect(jsonData);
 *   if (parser) {
 *     const result = parser.parse(jsonData);
 *   }
 *
 * Adding new formats:
 *   1. Create parser in parsers/ directory implementing DeviceParser
 *   2. Import and register below with appropriate priority
 */

import { deviceParserRegistry } from './registry';

// Import all parsers
import { coldcardNestedParser } from './parsers/coldcardNested';
import { coldcardFlatParser } from './parsers/coldcardFlat';
import { keystoneStandardParser, keystoneMultisigParser } from './parsers/keystone';
import { descriptorJsonParser, descriptorStringParser } from './parsers/descriptor';
import { ledgerParser } from './parsers/ledger';
import { bitboxParser } from './parsers/bitbox';
import { genericJsonParser, plainXpubParser, simpleColdcardParser } from './parsers/generic';

// Register all parsers (order doesn't matter - sorted by priority)
deviceParserRegistry.register(descriptorJsonParser);      // 92 - Output descriptor JSON
deviceParserRegistry.register(coldcardNestedParser);      // 90 - Coldcard bip44/49/84
deviceParserRegistry.register(coldcardFlatParser);        // 88 - Coldcard p2wsh/p2sh
deviceParserRegistry.register(keystoneMultisigParser);    // 86 - Keystone multisig
deviceParserRegistry.register(keystoneStandardParser);    // 85 - Keystone standard
deviceParserRegistry.register(simpleColdcardParser);      // 84 - Simple xfp + xpub
deviceParserRegistry.register(bitboxParser);              // 82 - BitBox02
deviceParserRegistry.register(ledgerParser);              // 80 - Ledger Live
deviceParserRegistry.register(genericJsonParser);         // 30 - Generic JSON fallback
deviceParserRegistry.register(descriptorStringParser);    // 20 - Plain descriptor string
deviceParserRegistry.register(plainXpubParser);           // 10 - Plain xpub fallback

// Re-export types
export type {
  DeviceParser,
  DeviceParseResult,
  DeviceAccount,
  FormatDetectionResult,
  DeviceParserRegistryConfig,
} from './types';

// Export registry
export { deviceParserRegistry } from './registry';

/**
 * Convenience function to parse device data
 * Auto-detects format and returns parsed result
 *
 * @param data JSON object or raw string to parse
 * @returns Parsed result with format ID, or null if no parser could handle it
 */
export function parseDeviceData(data: unknown): (import('./types').DeviceParseResult & { format: string }) | null {
  return deviceParserRegistry.parse(data);
}

/**
 * Convenience function to parse JSON string
 * Handles JSON.parse internally
 *
 * @param jsonString JSON string or plain text to parse
 * @returns Parsed result with format ID, or null if no parser could handle it
 */
export function parseDeviceJson(jsonString: string): (import('./types').DeviceParseResult & { format: string }) | null {
  return deviceParserRegistry.parseJson(jsonString);
}

// Export individual parsers for direct use if needed
export { coldcardNestedParser } from './parsers/coldcardNested';
export { coldcardFlatParser } from './parsers/coldcardFlat';
export { keystoneStandardParser, keystoneMultisigParser } from './parsers/keystone';
export { descriptorJsonParser, descriptorStringParser } from './parsers/descriptor';
export { ledgerParser } from './parsers/ledger';
export { bitboxParser } from './parsers/bitbox';
export { genericJsonParser, plainXpubParser, simpleColdcardParser } from './parsers/generic';

/**
 * Descriptor Parser Module
 *
 * Barrel file re-exporting the public API from all sub-modules.
 * External consumers should import from this index.
 */

// Types
export type {
  ParsedDevice,
  ScriptType,
  Network,
  ParsedDescriptor,
  DescriptorParseError,
  JsonImportDevice,
  JsonImportConfig,
  WalletExportFormat,
  ColdcardJsonExport,
  BlueWalletTextFormat,
} from './types';

// Descriptor parsing
export { parseDescriptorForImport, validateDescriptor, extractDescriptorFromText, isDescriptorTextFormat } from './descriptorParser';

// JSON import parsing
export { validateJsonImport, parseJsonImport, isWalletExportFormat } from './jsonParser';

// Coldcard export parsing
export { isColdcardExportFormat, parseColdcardExport } from './coldcardParser';

// BlueWallet text format parsing
export { isBlueWalletTextFormat, parseBlueWalletText, parseBlueWalletTextImport } from './bluewalletParser';

// Import input orchestrator
export { parseImportInput } from './parseImportInput';

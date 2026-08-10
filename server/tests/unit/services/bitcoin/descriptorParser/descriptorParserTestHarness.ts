export {
  extractDescriptorFromText,
  extractDescriptorPairFromText,
  resolveDescriptorTextPair,
  isDescriptorTextFormat,
  parseBlueWalletTextImport,
  parseColdcardExport,
  parseDescriptorForImport,
  parseImportInput,
  parseJsonImport,
  validateDescriptor,
  validateJsonImport,
  type JsonImportConfig,
  type Network,
  type ParsedDescriptor,
  type ParsedDevice,
  type ScriptType,
} from '../../../../../src/services/bitcoin/descriptorParser';
export { computeDescriptorChecksum } from '../../../../../src/services/bitcoin/descriptorParser/checksum';
export { testXpubs } from '../../../../fixtures/bitcoin';

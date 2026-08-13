/**
 * Compatibility exports for the generated, pinned Bitcoin Core key_io corpus.
 * Regenerate with `node scripts/generate-address-key-corpora.mjs`.
 */
export {
  ADDRESS_KEY_CORPUS_PROVENANCE,
  ADDRESS_KEY_CORPUS_EVIDENCE_TIER,
  KEY_IO_PUBLIC_ADDRESSES,
  KEY_IO_MAINNET_ADDRESSES,
  KEY_IO_VALID_WAIVERS,
  KEY_IO_INVALID_VECTORS,
  KEY_IO_INVALID_ADDRESSES,
  type KeyIoAddressVector,
  type KeyIoChain,
} from './generated/address-key-corpora';

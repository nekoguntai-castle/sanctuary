/**
 * BIP-329 Official Test Vectors (Wallet Labels Export Format)
 *
 * These are the official test vectors from the BIP-329 specification:
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 *
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

export interface Bip329Label {
  type: 'tx' | 'addr' | 'pubkey' | 'input' | 'output' | 'xpub';
  ref: string;
  label?: string;
  origin?: string;
  spendable?: boolean;
}

/**
 * Example records from the BIP-329 specification
 *
 * Each line in a BIP-329 export is a JSON object with:
 * - type: "tx", "addr", "pubkey", "input", "output", or "xpub"
 * - ref: reference identifier (txid, address, pubkey, etc.)
 * - label: optional human-readable label
 * - origin: optional key origin info
 * - spendable: optional boolean for address records
 */
export const BIP329_EXAMPLE_RECORDS: Bip329Label[] = [
  {
    type: 'tx',
    ref: 'f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd',
    label: 'Transaction',
  },
  {
    type: 'addr',
    ref: 'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c',
    label: 'Address',
  },
  {
    type: 'pubkey',
    ref: '0283409659355b6d1cc3c32decd5d561abaac86c37a353b52895a5e6c196d6f448',
    label: 'Public Key',
  },
  {
    type: 'input',
    ref: 'f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:0',
    label: 'Input',
  },
  {
    type: 'output',
    ref: 'f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:1',
    label: 'Output',
  },
  {
    type: 'xpub',
    ref: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
    label: 'Extended Public Key',
  },
];

/**
 * Valid JSONL format - each line is a separate JSON object
 * This is the expected export format from BIP-329
 */
export const BIP329_VALID_JSONL = `{"type":"tx","ref":"f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd","label":"Transaction"}
{"type":"addr","ref":"bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c","label":"Address"}
{"type":"pubkey","ref":"0283409659355b6d1cc3c32decd5d561abaac86c37a353b52895a5e6c196d6f448","label":"Public Key"}
{"type":"input","ref":"f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:0","label":"Input"}
{"type":"output","ref":"f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:1","label":"Output"}
{"type":"xpub","ref":"xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8","label":"Extended Public Key"}`;

/**
 * Invalid label records that should be rejected
 */
export const BIP329_INVALID_RECORDS = [
  {
    json: '{"type":"invalid","ref":"abc","label":"test"}',
    reason: 'Invalid type field',
  },
  {
    json: '{"ref":"abc","label":"test"}',
    reason: 'Missing type field',
  },
  {
    json: '{"type":"tx","label":"test"}',
    reason: 'Missing ref field',
  },
  {
    json: '{"type":"tx","ref":""}',
    reason: 'Empty ref field',
  },
  {
    json: 'not json at all',
    reason: 'Invalid JSON',
  },
  {
    json: '',
    reason: 'Empty line',
  },
];

/**
 * Test vectors for round-trip encoding/decoding
 * Each record should survive being serialized to JSONL and parsed back
 */
export const BIP329_ROUNDTRIP_VECTORS: Bip329Label[] = [
  // Transaction with special characters in label
  {
    type: 'tx',
    ref: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    label: 'Payment for "services" & stuff',
  },
  // Address with origin info
  {
    type: 'addr',
    ref: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    label: 'Cold storage',
    origin: "m/84'/0'/0'",
    spendable: true,
  },
  // Transaction with no label (just a ref)
  {
    type: 'tx',
    ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  },
  // Xpub with origin
  {
    type: 'xpub',
    ref: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
    label: 'Main wallet',
    origin: "m/84'/0'/0'",
  },
];

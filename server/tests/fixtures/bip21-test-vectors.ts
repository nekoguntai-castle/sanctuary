/**
 * BIP-21 Official Test Vectors (URI Scheme)
 *
 * These are the test vectors from the BIP-21 specification:
 * https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
 *
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

export interface Bip21TestVector {
  uri: string;
  expectedAddress: string;
  expectedAmount?: number;  // In BTC (not satoshis)
  expectedLabel?: string;
  expectedMessage?: string;
  isValid: boolean;
  comment: string;
}

/**
 * Valid BIP-21 URIs from the specification
 *
 * From the BIP:
 * bitcoin:<address>[?amount=<amount>][?label=<label>][?message=<message>]
 *
 * amount is in decimal BTC (not satoshis)
 */
export const BIP21_VALID_VECTORS: Bip21TestVector[] = [
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    isValid: true,
    comment: 'Just an address (BIP-21 example 1)',
  },
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?label=Luke-Jr',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedLabel: 'Luke-Jr',
    isValid: true,
    comment: 'Address with label (BIP-21 example 2)',
  },
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAmount: 20.3,
    expectedLabel: 'Luke-Jr',
    isValid: true,
    comment: 'Address with amount and label (BIP-21 example 3)',
  },
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAmount: 50,
    expectedLabel: 'Luke-Jr',
    expectedMessage: 'Donation for project xyz',
    isValid: true,
    comment: 'Address with amount, label, and message (BIP-21 example 4)',
  },
];

/**
 * Extended valid vectors for comprehensive testing
 * Includes SegWit and Taproot addresses
 */
export const BIP21_EXTENDED_VALID_VECTORS: Bip21TestVector[] = [
  // SegWit v0 (bech32)
  {
    uri: 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    expectedAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    isValid: true,
    comment: 'Native SegWit v0 address (P2WPKH)',
  },
  {
    uri: 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.001',
    expectedAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    expectedAmount: 0.001,
    isValid: true,
    comment: 'Native SegWit with small amount',
  },
  // Taproot (bech32m)
  {
    uri: 'bitcoin:bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
    expectedAddress: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
    isValid: true,
    comment: 'Taproot address (P2TR)',
  },
  // Case insensitive scheme
  {
    uri: 'BITCOIN:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    isValid: true,
    comment: 'Uppercase BITCOIN scheme (allowed per BIP-21)',
  },
  {
    uri: 'Bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    isValid: true,
    comment: 'Mixed case Bitcoin scheme',
  },
  // Amount edge cases
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=21000000',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAmount: 21000000,
    isValid: true,
    comment: 'Maximum supply amount',
  },
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=0.00000001',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAmount: 0.00000001,
    isValid: true,
    comment: 'Minimum amount (1 satoshi)',
  },
  // Testnet
  {
    uri: 'bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    expectedAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    isValid: true,
    comment: 'Testnet SegWit address',
  },
  // URL-encoded parameters
  {
    uri: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?label=Luke%20Jr%27s%20Cafe&message=Payment%20for%20coffee%20%26%20cake',
    expectedAddress: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedLabel: "Luke Jr's Cafe",
    expectedMessage: 'Payment for coffee & cake',
    isValid: true,
    comment: 'URL-encoded special characters in label and message',
  },
];

/**
 * Invalid BIP-21 URIs that should be rejected
 */
export const BIP21_INVALID_VECTORS: Bip21TestVector[] = [
  {
    uri: '',
    expectedAddress: '',
    isValid: false,
    comment: 'Empty string',
  },
  {
    uri: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAddress: '',
    isValid: false,
    comment: 'Address without bitcoin: scheme',
  },
  {
    uri: 'litecoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
    expectedAddress: '',
    isValid: false,
    comment: 'Wrong scheme (litecoin)',
  },
  {
    uri: 'bitcoin:',
    expectedAddress: '',
    isValid: false,
    comment: 'Scheme with no address',
  },
  {
    uri: 'https://bitcoin.org',
    expectedAddress: '',
    isValid: false,
    comment: 'HTTP URL, not a bitcoin URI',
  },
  {
    uri: 'ethereum:0x1234567890abcdef1234567890abcdef12345678',
    expectedAddress: '',
    isValid: false,
    comment: 'Ethereum URI',
  },
];

/**
 * Amount conversion test vectors
 * Tests BTC to satoshi conversion edge cases
 */
export const BIP21_AMOUNT_VECTORS = [
  { btc: '1', expectedSatoshis: 100000000 },
  { btc: '0.1', expectedSatoshis: 10000000 },
  { btc: '0.01', expectedSatoshis: 1000000 },
  { btc: '0.001', expectedSatoshis: 100000 },
  { btc: '0.0001', expectedSatoshis: 10000 },
  { btc: '0.00001', expectedSatoshis: 1000 },
  { btc: '0.000001', expectedSatoshis: 100 },
  { btc: '0.0000001', expectedSatoshis: 10 },
  { btc: '0.00000001', expectedSatoshis: 1 },
  { btc: '21000000', expectedSatoshis: 2100000000000000 },
  { btc: '0', expectedSatoshis: 0 },
  { btc: '1.00000000', expectedSatoshis: 100000000 },
  { btc: '20.3', expectedSatoshis: 2030000000 },
];

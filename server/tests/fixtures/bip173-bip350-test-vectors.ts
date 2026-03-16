/**
 * BIP-173 (Bech32) and BIP-350 (Bech32m) Official Test Vectors
 *
 * BIP-173: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
 * BIP-350: https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki
 *
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

// ============================================================
// BIP-173: Bech32 encoding test vectors
// ============================================================

/**
 * Valid Bech32 strings (not necessarily valid Bitcoin addresses)
 */
export const VALID_BECH32_STRINGS = [
  'A12UEL5L',
  'a12uel5l',
  'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
  'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
  '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
  'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
  '?1ezyfcl',
];

/**
 * Invalid Bech32 strings
 */
export const INVALID_BECH32_STRINGS = [
  { str: ' 1nwldj5', reason: 'HRP character out of range (space)' },
  { str: '\x7f1axkwrx', reason: 'HRP character out of range (DEL)' },
  { str: '\x801eym55h', reason: 'HRP character out of range (0x80)' },
  { str: 'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx', reason: 'Overall max length exceeded' },
  { str: 'pzry9x0s0muk', reason: 'No separator character' },
  { str: '1pzry9x0s0muk', reason: 'Empty HRP' },
  { str: 'x1b4n0q5v', reason: 'Invalid data character' },
  { str: 'li1dgmt3', reason: 'Too short checksum' },
  { str: 'de1lg7wt\xff', reason: 'Invalid character in checksum' },
  { str: 'A1G7SGD8', reason: 'Checksum calculated with uppercase form of HRP' },
  { str: '10a06t8', reason: 'Empty HRP with invalid checksum' },
  { str: '1qzzfhee', reason: 'Empty HRP' },
];

// ============================================================
// BIP-173: Valid SegWit address test vectors
// ============================================================

export interface SegwitAddressVector {
  address: string;
  scriptPubKeyHex: string;
}

/**
 * Valid SegWit addresses from BIP-173 specification
 * Note: BIP-173 originally used bech32 for all witness versions.
 * BIP-350 later changed v1+ to use bech32m.
 */
export const BIP173_VALID_ADDRESSES: SegwitAddressVector[] = [
  {
    address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
    scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
  },
  {
    address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
    scriptPubKeyHex: '00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262',
  },
  {
    address: 'tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy',
    scriptPubKeyHex: '0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433',
  },
];

/**
 * Invalid SegWit addresses from BIP-173
 */
export const BIP173_INVALID_ADDRESSES = [
  { address: 'tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty', reason: 'Invalid human-readable part' },
  { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', reason: 'Invalid checksum' },
  { address: 'BC13W508D6QEJXTDG4Y5R3ZARVARY0C5XW7KN40WF2', reason: 'Invalid witness version' },
  { address: 'bc1rw5uspcuh', reason: 'Invalid program length' },
  { address: 'bc10w508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kw5rljs90', reason: 'Invalid program length (too long)' },
  { address: 'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', reason: 'Invalid program length for witness version 0' },
  { address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7', reason: 'Mixed case' },
  { address: 'bc1zw508d6qejxtdg4y5r3zarvaryvqyzf3du', reason: 'Zero padding of more than 4 bits' },
  { address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3pjxtptv', reason: 'Non-zero padding in 8-to-5 conversion' },
  { address: 'bc1gmk9yu', reason: 'Empty data section' },
];

// ============================================================
// BIP-350: Bech32m encoding test vectors
// ============================================================

/**
 * Valid Bech32m strings (not necessarily valid Bitcoin addresses)
 */
export const VALID_BECH32M_STRINGS = [
  'A1LQFN3A',
  'a1lqfn3a',
  'an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6',
  'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
  '11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8',
  'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
  '?1v759aa',
];

/**
 * Invalid Bech32m strings
 */
export const INVALID_BECH32M_STRINGS = [
  { str: ' 1xj0phk', reason: 'HRP character out of range' },
  { str: '\x7f1g6xzxy', reason: 'HRP character out of range' },
  { str: '\x801vctc34', reason: 'HRP character out of range' },
  { str: 'an84characterslonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11d6pts4', reason: 'Overall max length exceeded' },
  { str: 'qyrz8wqd2c9m', reason: 'No separator character' },
  { str: '1qyrz8wqd2c9m', reason: 'Empty HRP' },
  { str: 'y1b0jsk6g', reason: 'Invalid data character' },
  { str: 'lt1igcx5c0', reason: 'Invalid data character' },
  { str: 'in1muywd', reason: 'Too short checksum' },
  { str: 'mm1crxm3i', reason: 'Invalid character in checksum' },
  { str: 'au1s5cgom', reason: 'Invalid character in checksum' },
  { str: 'M1VUXWEZ', reason: 'Checksum calculated with uppercase form of HRP' },
  { str: '16plkw9', reason: 'Empty HRP' },
  { str: '1p2gdwpf', reason: 'Empty HRP' },
];

// ============================================================
// BIP-350: Valid SegWit address test vectors (v0 bech32 + v1+ bech32m)
// ============================================================

/**
 * Valid SegWit addresses from BIP-350 specification
 * v0 uses bech32, v1+ uses bech32m
 */
export const BIP350_VALID_ADDRESSES: SegwitAddressVector[] = [
  {
    address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
    scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
  },
  {
    address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
    scriptPubKeyHex: '00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262',
  },
  {
    address: 'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y',
    scriptPubKeyHex: '5128751e76e8199196d454941c45d1b3a323f1433bd6751e76e8199196d454941c45d1b3a323f1433bd6',
  },
  {
    address: 'BC1SW50QGDZ25J',
    scriptPubKeyHex: '6002751e',
  },
  {
    address: 'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs',
    scriptPubKeyHex: '5210751e76e8199196d454941c45d1b3a323',
  },
  {
    address: 'tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy',
    scriptPubKeyHex: '0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433',
  },
  {
    address: 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c',
    scriptPubKeyHex: '5120000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433',
  },
  {
    address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
    scriptPubKeyHex: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  },
];

/**
 * Invalid SegWit addresses from BIP-350
 */
export const BIP350_INVALID_ADDRESSES = [
  { address: 'tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut', reason: 'Invalid human-readable part' },
  { address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', reason: 'Invalid checksum (bech32 instead of bech32m)' },
  { address: 'tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf', reason: 'Invalid checksum (bech32 instead of bech32m)' },
  { address: 'BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL', reason: 'Invalid checksum (bech32 instead of bech32m)' },
  { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh', reason: 'Invalid checksum (bech32m instead of bech32)' },
  { address: 'tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47', reason: 'Invalid checksum (bech32m instead of bech32)' },
  { address: 'bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4', reason: 'Invalid character in checksum' },
  { address: 'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R', reason: 'Invalid witness version' },
  { address: 'bc1pw5dgrnzv', reason: 'Invalid program length (1 byte)' },
  { address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav', reason: 'Invalid program length (41 bytes)' },
  { address: 'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', reason: 'Invalid program length for witness version 0' },
  { address: 'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq', reason: 'Mixed case' },
  { address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf', reason: 'Zero padding of more than 4 bits' },
  { address: 'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j', reason: 'Non-zero padding in 8-to-5 conversion' },
  { address: 'bc1gmk9yu', reason: 'Empty data section' },
];

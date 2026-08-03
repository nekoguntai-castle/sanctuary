import { describe,expect,it } from 'vitest';
import {
addressMatchesNetwork,
getAddressNetwork,
getAddressType,
isMainnetAddress,
isTestnetAddress,
validateAddress,
} from '../../src/utils/validateAddress';

describe('validateAddress', () => {
  describe('Valid mainnet addresses', () => {
    it('should accept valid legacy (P2PKH) addresses starting with 1', () => {
      expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
      expect(validateAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
    });

    it('should accept valid P2SH addresses starting with 3', () => {
      expect(validateAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
      expect(validateAddress('3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC')).toBe(true);
    });

    it('should accept valid native SegWit (bech32) addresses starting with bc1q', () => {
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
      expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
    });

    it('should accept valid Taproot (bech32m) addresses starting with bc1p', () => {
      expect(validateAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
      // Taproot addresses are 62 characters (bc1p + 58 chars)
      expect(validateAddress('bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wf0qm')).toBe(true);
    });
  });

  describe('Valid testnet addresses', () => {
    it('should accept valid testnet legacy addresses starting with m or n', () => {
      expect(validateAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
      expect(validateAddress('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
    });

    it('should accept valid testnet P2SH addresses starting with 2', () => {
      expect(validateAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
      expect(validateAddress('2N8hwP1WmJrFF5QWABn38y63uYLhnJYJYTF')).toBe(true);
    });

    it('should accept valid testnet SegWit addresses starting with tb1', () => {
      expect(validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
      expect(validateAddress('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7')).toBe(true);
    });
  });

  describe('Invalid addresses', () => {
    it('should reject empty string', () => {
      expect(validateAddress('')).toBe(false);
    });

    it('should reject whitespace-only string', () => {
      expect(validateAddress('   ')).toBe(false);
    });

    it('should reject addresses that are too short', () => {
      expect(validateAddress('1A1zP1')).toBe(false);
      expect(validateAddress('bc1q')).toBe(false);
    });

    it('should reject addresses with invalid characters', () => {
      // Note: Our regex-based validation is permissive for quick UI feedback
      // Full bech32/base58 checksum validation happens on the server
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t!')).toBe(false); // Contains !
      expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7Div@Na')).toBe(false); // Contains @
    });

    it('should reject addresses with wrong prefix', () => {
      expect(validateAddress('5A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
      expect(validateAddress('xc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    });

    it('should reject addresses with wrong length for type', () => {
      expect(validateAddress('bc1qw508')).toBe(false);
      expect(validateAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg32')).toBe(false); // Too short for taproot
    });

    it('should reject completely invalid strings', () => {
      expect(validateAddress('not-a-bitcoin-address')).toBe(false);
      expect(validateAddress('1234567890')).toBe(false);
      expect(validateAddress('hello@world.com')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should trim whitespace before validation', () => {
      expect(validateAddress('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe(true);
      expect(validateAddress('\n1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\n')).toBe(true);
    });

    it('should handle null or undefined inputs gracefully', () => {
      expect(validateAddress(null as any)).toBe(false);
      expect(validateAddress(undefined as any)).toBe(false);
    });

    it('should handle minimum valid length addresses', () => {
      // Legacy addresses can be 26-35 characters
      expect(validateAddress('17VZNX1SN5NtKa8UQFxwQbFeFc3iqRYhem')).toBe(true); // 34 chars
    });

    it('should handle maximum valid length addresses', () => {
      // Bech32 addresses can be up to 90 characters
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    });
  });
});

describe('getAddressType', () => {
  it('should identify legacy addresses', () => {
    expect(getAddressType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('legacy');
  });

  it('should identify P2SH addresses', () => {
    expect(getAddressType('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe('p2sh');
  });

  it('should identify native SegWit addresses', () => {
    expect(getAddressType('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('native_segwit');
  });

  it('should identify Taproot addresses', () => {
    expect(getAddressType('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe('taproot');
  });

  it('should identify testnet legacy addresses', () => {
    expect(getAddressType('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('testnet_legacy');
    expect(getAddressType('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe('testnet_legacy');
  });

  it('should identify testnet P2SH addresses', () => {
    expect(getAddressType('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('testnet_p2sh');
  });

  it('should identify testnet SegWit addresses', () => {
    expect(getAddressType('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('testnet_segwit');
  });

  it('should return null for invalid addresses', () => {
    expect(getAddressType('invalid-address')).toBeNull();
    expect(getAddressType('')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(getAddressType('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe('native_segwit');
  });
});

describe('isMainnetAddress', () => {
  it('should return true for mainnet legacy addresses', () => {
    expect(isMainnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
  });

  it('should return true for mainnet P2SH addresses', () => {
    expect(isMainnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
  });

  it('should return true for mainnet native SegWit addresses', () => {
    expect(isMainnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
  });

  it('should return true for mainnet Taproot addresses', () => {
    expect(isMainnetAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
  });

  it('should return false for testnet addresses', () => {
    expect(isMainnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(false);
    expect(isMainnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(false);
    expect(isMainnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
  });

  it('should return false for invalid addresses', () => {
    expect(isMainnetAddress('invalid-address')).toBe(false);
    expect(isMainnetAddress('')).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(isMainnetAddress('  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa  ')).toBe(true);
  });
});

describe('isTestnetAddress', () => {
  it('should return true for testnet legacy addresses', () => {
    expect(isTestnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
    expect(isTestnetAddress('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
  });

  it('should return true for testnet P2SH addresses', () => {
    expect(isTestnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
  });

  it('should return true for testnet SegWit addresses', () => {
    expect(isTestnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
  });

  it('should return false for mainnet addresses', () => {
    expect(isTestnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
    expect(isTestnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(false);
    expect(isTestnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    expect(isTestnetAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(false);
  });

  it('should return false for invalid addresses', () => {
    expect(isTestnetAddress('invalid-address')).toBe(false);
    expect(isTestnetAddress('')).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(isTestnetAddress('  tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx  ')).toBe(true);
  });
});

describe('getAddressNetwork', () => {
  it('should return mainnet for mainnet legacy addresses', () => {
    expect(getAddressNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('mainnet');
  });

  it('should return mainnet for mainnet P2SH addresses', () => {
    expect(getAddressNetwork('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe('mainnet');
  });

  it('should return mainnet for mainnet native SegWit addresses', () => {
    expect(getAddressNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('mainnet');
  });

  it('should return mainnet for mainnet Taproot addresses', () => {
    expect(getAddressNetwork('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe('mainnet');
  });

  it('should return testnet for testnet legacy addresses', () => {
    expect(getAddressNetwork('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('testnet');
    expect(getAddressNetwork('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe('testnet');
  });

  it('should return testnet for testnet P2SH addresses', () => {
    expect(getAddressNetwork('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('testnet');
  });

  it('should return testnet for testnet SegWit addresses', () => {
    expect(getAddressNetwork('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('testnet');
  });

  it('should return null for invalid addresses', () => {
    expect(getAddressNetwork('invalid-address')).toBeNull();
    expect(getAddressNetwork('')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(getAddressNetwork('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe('mainnet');
    expect(getAddressNetwork('  tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx  ')).toBe('testnet');
  });
});

describe('addressMatchesNetwork - Cross-Network Rejection', () => {
  describe('Mainnet wallet address validation', () => {
    it('should accept mainnet legacy addresses on mainnet wallets', () => {
      expect(addressMatchesNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet')).toBe(true);
    });

    it('should accept mainnet P2SH addresses on mainnet wallets', () => {
      expect(addressMatchesNetwork('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy', 'mainnet')).toBe(true);
    });

    it('should accept mainnet native SegWit addresses on mainnet wallets', () => {
      expect(addressMatchesNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet')).toBe(true);
    });

    it('should accept mainnet Taproot addresses on mainnet wallets', () => {
      expect(addressMatchesNetwork('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'mainnet')).toBe(true);
    });

    it('should reject testnet addresses on mainnet wallets', () => {
      expect(addressMatchesNetwork('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'mainnet')).toBe(false);
      expect(addressMatchesNetwork('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx', 'mainnet')).toBe(false);
      expect(addressMatchesNetwork('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc', 'mainnet')).toBe(false);
      expect(addressMatchesNetwork('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mainnet')).toBe(false);
    });
  });

  describe('Testnet wallet address validation', () => {
    it('should accept testnet legacy addresses on testnet wallets', () => {
      expect(addressMatchesNetwork('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'testnet')).toBe(true);
      expect(addressMatchesNetwork('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx', 'testnet')).toBe(true);
    });

    it('should accept testnet P2SH addresses on testnet wallets', () => {
      expect(addressMatchesNetwork('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc', 'testnet')).toBe(true);
    });

    it('should accept testnet SegWit addresses on testnet wallets', () => {
      expect(addressMatchesNetwork('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet')).toBe(true);
    });

    it('should reject mainnet addresses on testnet wallets', () => {
      expect(addressMatchesNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'testnet')).toBe(false);
      expect(addressMatchesNetwork('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy', 'testnet')).toBe(false);
      expect(addressMatchesNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'testnet')).toBe(false);
      expect(addressMatchesNetwork('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'testnet')).toBe(false);
    });
  });

  describe('Regtest wallet address validation', () => {
    it('should accept testnet-format addresses on regtest wallets', () => {
      // Regtest uses same address format as testnet
      expect(addressMatchesNetwork('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'regtest')).toBe(true);
      expect(addressMatchesNetwork('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc', 'regtest')).toBe(true);
      expect(addressMatchesNetwork('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'regtest')).toBe(true);
    });

    it('should reject mainnet addresses on regtest wallets', () => {
      expect(addressMatchesNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'regtest')).toBe(false);
      expect(addressMatchesNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'regtest')).toBe(false);
    });
  });

  describe('Invalid addresses', () => {
    it('should return false for invalid addresses regardless of network', () => {
      expect(addressMatchesNetwork('invalid-address', 'mainnet')).toBe(false);
      expect(addressMatchesNetwork('invalid-address', 'testnet')).toBe(false);
      expect(addressMatchesNetwork('', 'mainnet')).toBe(false);
    });
  });

  describe('Whitespace handling', () => {
    it('should trim whitespace before validation', () => {
      expect(addressMatchesNetwork('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ', 'mainnet')).toBe(true);
      expect(addressMatchesNetwork('  tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx  ', 'testnet')).toBe(true);
    });
  });
});

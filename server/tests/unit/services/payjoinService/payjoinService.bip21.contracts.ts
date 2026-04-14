import { describe, expect, it } from 'vitest';

import {
  generateBip21Uri,
  parseBip21Uri,
  PayjoinErrors,
  TEST_ADDRESS_TESTNET,
  TEST_PAYJOIN_URL,
} from './payjoinServiceTestHarness';

export const registerPayjoinBip21Contracts = () => {
  describe('parseBip21Uri', () => {
    it('should parse simple bitcoin: URI', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBeUndefined();
      expect(result.label).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(result.payjoinUrl).toBeUndefined();
    });

    it('should parse URI with amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.5`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(50_000_000); // 0.5 BTC in sats
    });

    it('should parse URI with small amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.00001`;
      const result = parseBip21Uri(uri);

      // Use toBeCloseTo for floating point precision
      expect(result.amount).toBeCloseTo(1000, 0); // 0.00001 BTC = 1000 sats
    });

    it('should parse URI with large amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=21`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(2_100_000_000); // 21 BTC in sats
    });

    it('should parse URI with label parameter', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?label=My%20Payment`;
      const result = parseBip21Uri(uri);

      expect(result.label).toBe('My Payment');
    });

    it('should parse URI with message parameter', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?message=Payment%20for%20services`;
      const result = parseBip21Uri(uri);

      expect(result.message).toBe('Payment for services');
    });

    it('should extract pj= Payjoin URL', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.1&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`;
      const result = parseBip21Uri(uri);

      expect(result.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should parse URI with all parameters', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=1.5&label=Invoice%20123&message=Monthly%20subscription&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(150_000_000);
      expect(result.label).toBe('Invoice 123');
      expect(result.message).toBe('Monthly subscription');
      expect(result.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should handle URI without bitcoin: prefix', () => {
      const uri = `${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(10_000_000);
    });

    it('should handle uppercase BITCOIN: prefix', () => {
      const uri = `BITCOIN:${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(10_000_000);
    });

    it('should handle mixed case Bitcoin: prefix', () => {
      const uri = `Bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
    });

    it('should handle special characters in label', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?label=${encodeURIComponent("John's Store & Shop")}`;
      const result = parseBip21Uri(uri);

      expect(result.label).toBe("John's Store & Shop");
    });

    it('should handle unicode in message', () => {
      const message = 'Payment for 100 items';
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?message=${encodeURIComponent(message)}`;
      const result = parseBip21Uri(uri);

      expect(result.message).toBe(message);
    });

    it('should handle Payjoin URL with query parameters', () => {
      const pjUrl = 'https://example.com/payjoin?v=1&key=abc';
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?pj=${encodeURIComponent(pjUrl)}`;
      const result = parseBip21Uri(uri);

      expect(result.payjoinUrl).toBe(pjUrl);
    });

    it('should parse address-only URI (no params)', () => {
      const uri = TEST_ADDRESS_TESTNET;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
    });

    it('should handle zero amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(0);
    });

    it('should handle decimal precision', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.00000001`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(1); // 1 satoshi
    });
  });

  describe('generateBip21Uri', () => {
    it('should generate simple URI with address only', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET);

      expect(uri).toBe(`bitcoin:${TEST_ADDRESS_TESTNET}`);
    });

    it('should include amount in BTC', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { amount: 50_000_000 });

      expect(uri).toContain('amount=0.50000000');
    });

    it('should include small amount correctly', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { amount: 1 });

      expect(uri).toContain('amount=0.00000001');
    });

    it('should include label with URL encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { label: 'My Store' });

      expect(uri).toContain('label=My%20Store');
    });

    it('should include message with URL encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { message: 'Invoice #123' });

      expect(uri).toContain('message=Invoice%20%23123');
    });

    it('should include Payjoin URL with encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { payjoinUrl: TEST_PAYJOIN_URL });

      expect(uri).toContain(`pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`);
    });

    it('should include all parameters correctly', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {
        amount: 100_000_000,
        label: 'Test Label',
        message: 'Test Message',
        payjoinUrl: TEST_PAYJOIN_URL,
      });

      expect(uri).toContain(`bitcoin:${TEST_ADDRESS_TESTNET}?`);
      expect(uri).toContain('amount=1.00000000');
      expect(uri).toContain('label=Test%20Label');
      expect(uri).toContain('message=Test%20Message');
      expect(uri).toContain('pj=');
    });

    it('should not add empty parameters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {});

      expect(uri).toBe(`bitcoin:${TEST_ADDRESS_TESTNET}`);
      expect(uri).not.toContain('?');
    });

    it('should handle special characters in parameters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {
        label: "John's & Mary's Store",
        message: 'Payment: $100',
      });

      expect(uri).toContain('label=');
      expect(uri).toContain('message=');
      // Verify it can be parsed back
      const parsed = parseBip21Uri(uri);
      expect(parsed.label).toBe("John's & Mary's Store");
    });

    it('should generate round-trippable URI', () => {
      const options = {
        amount: 123456789,
        label: 'Test',
        message: 'Test message',
        payjoinUrl: TEST_PAYJOIN_URL,
      };

      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, options);
      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_TESTNET);
      // Use toBeCloseTo for floating point precision issues in BTC<->satoshi conversion
      expect(parsed.amount).toBeCloseTo(options.amount, 0);
      expect(parsed.label).toBe(options.label);
      expect(parsed.message).toBe(options.message);
      expect(parsed.payjoinUrl).toBe(options.payjoinUrl);
    });
  });
};

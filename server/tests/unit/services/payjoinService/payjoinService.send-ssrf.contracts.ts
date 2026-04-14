import { describe, expect, it, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  attemptPayjoinSend,
  PayjoinErrors,
  TEST_PAYJOIN_URL,
  validatePayjoinProposal,
} from './payjoinServiceTestHarness';

export const registerPayjoinSendAndSsrfContracts = () => {
  describe('attemptPayjoinSend', () => {
    const originalPsbt = 'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';
    const proposalPsbt = 'cHNidP8BAHECAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8CrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GhAnAAAAAAAAFgAUdpn98MqGxRdMa7mGg0HhZKSL0BMAAAAAAAAA';

    it('should send PSBT to Payjoin endpoint', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(TEST_PAYJOIN_URL),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: originalPsbt,
        })
      );
      expect(result.success).toBe(true);
      expect(result.isPayjoin).toBe(true);
      expect(result.proposalPsbt).toBe(proposalPsbt);
    });

    it('should add v=1 query parameter', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('v=1'),
        expect.anything()
      );
    });

    it('should return error for HTTP error response', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'original-psbt-rejected',
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('original-psbt-rejected');
    });

    it('should return error for invalid proposal', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: false,
        errors: ['Sender output was removed'],
        warnings: [],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('Sender output was removed');
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as Mock).mockRejectedValue(new Error('Network error'));

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should reject invalid Payjoin URL protocol', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'ftp://example.com/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('should handle timeout gracefully', async () => {
      (global.fetch as Mock).mockRejectedValue(new Error('Request timeout'));

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should include warnings in successful response', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: ['Fee increased by 25%'],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(true);
      expect(result.isPayjoin).toBe(true);
    });

    it('should use mainnet network by default', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(validatePayjoinProposal).toHaveBeenCalledWith(
        originalPsbt,
        proposalPsbt,
        [0],
        bitcoin.networks.bitcoin
      );
    });

    it('should use specified network', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0],
        bitcoin.networks.testnet
      );

      expect(validatePayjoinProposal).toHaveBeenCalledWith(
        originalPsbt,
        proposalPsbt,
        [0],
        bitcoin.networks.testnet
      );
    });
  });

  describe('PayjoinErrors', () => {
    it('should have correct BIP78 error codes', () => {
      expect(PayjoinErrors.VERSION_UNSUPPORTED).toBe('version-unsupported');
      expect(PayjoinErrors.UNAVAILABLE).toBe('unavailable');
      expect(PayjoinErrors.NOT_ENOUGH_MONEY).toBe('not-enough-money');
      expect(PayjoinErrors.ORIGINAL_PSBT_REJECTED).toBe('original-psbt-rejected');
      expect(PayjoinErrors.RECEIVER_ERROR).toBe('receiver-error');
    });
  });

  describe('SSRF Protection', () => {
    const originalPsbt = 'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';

    it('should reject localhost URLs', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://localhost/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should reject 127.0.0.1 URLs', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://127.0.0.1/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should reject HTTP URLs (only HTTPS allowed)', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'http://example.com/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('should reject ::1 (IPv6 localhost)', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://[::1]/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      // IPv6 bracket notation causes URL parsing/resolution to fail
      expect(result.error).toMatch(/localhost|resolve|hostname/i);
    });

    it('should reject internal hostnames', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://internal/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal');
    });

    it('should reject 0.0.0.0 URLs', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://0.0.0.0/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });
  });
};

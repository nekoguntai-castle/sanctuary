import { describe, expect, it, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { OutboundResponseTooLargeError } from '../../../../src/services/outboundNetwork/nativeRequest';

import {
  attemptPayjoinSend,
  dnsLookupMock,
  isPrivateIP,
  PayjoinErrors,
  requestPinnedAddressMock,
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

    it('should preserve existing query parameters when adding v=1', async () => {
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(originalPsbt, `${TEST_PAYJOIN_URL}?pj=1`, [0]);

      expect(global.fetch).toHaveBeenCalledWith(
        `${TEST_PAYJOIN_URL}?pj=1&v=1`,
        expect.anything()
      );
    });

    it('resolves once, validates every answer, and pins the first validated address', async () => {
      dnsLookupMock.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ]).mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ]);
      (validatePayjoinProposal as Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });
      requestPinnedAddressMock.mockResolvedValueOnce({
        body: Buffer.from(proposalPsbt),
        ok: true,
        status: 200,
      });

      await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(dnsLookupMock).toHaveBeenCalledOnce();
      expect(dnsLookupMock).toHaveBeenCalledWith('example.com', {
        all: true,
        verbatim: true,
      });
      expect(requestPinnedAddressMock).toHaveBeenCalledWith(expect.objectContaining({
        resolvedAddress: '93.184.216.34',
        responseByteLimit: 102_400,
        timeoutMs: 30_000,
        url: expect.objectContaining({
          hostname: 'example.com',
        }),
      }));
    });

    it('rejects a mixed DNS answer set before any network request', async () => {
      dnsLookupMock.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ]);

      const result = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(result).toMatchObject({ success: false, isPayjoin: false });
      expect(result.error).toContain('private IP');
      expect(requestPinnedAddressMock).not.toHaveBeenCalled();
    });

    it('treats redirects as endpoint failures without following another hop', async () => {
      requestPinnedAddressMock.mockResolvedValueOnce({
        body: Buffer.from('https://127.0.0.1/internal'),
        ok: false,
        status: 302,
      });

      const result = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(result.error).toBe('Payjoin endpoint returned HTTP 302');
      expect(requestPinnedAddressMock).toHaveBeenCalledOnce();
    });

    it('preserves known BIP78 errors but sanitizes unknown endpoint bodies', async () => {
      requestPinnedAddressMock
        .mockResolvedValueOnce({
          body: Buffer.from(PayjoinErrors.ORIGINAL_PSBT_REJECTED),
          ok: false,
          status: 400,
        })
        .mockResolvedValueOnce({
          body: Buffer.from('secret backend stack at 10.0.0.4'),
          ok: false,
          status: 500,
        });

      const known = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);
      const unknown = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(known.error).toContain(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(unknown.error).toBe('Payjoin endpoint returned HTTP 500');
      expect(unknown.error).not.toContain('secret');
      expect(unknown.error).not.toContain('10.0.0.4');
    });

    it('accepts a response at the exact raw-byte limit', async () => {
      const exactBody = 'a'.repeat(102_400);
      requestPinnedAddressMock.mockResolvedValueOnce({
        body: Buffer.from(exactBody),
        ok: true,
        status: 200,
      });
      (validatePayjoinProposal as Mock).mockReturnValueOnce({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(result).toMatchObject({
        success: true,
        proposalPsbt: exactBody,
      });
    });

    it('returns one sanitized failure for oversized success and error responses', async () => {
      requestPinnedAddressMock
        .mockRejectedValueOnce(new OutboundResponseTooLargeError())
        .mockRejectedValueOnce(new OutboundResponseTooLargeError());

      const successBody = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);
      const errorBody = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(successBody.error).toBe('Payjoin response exceeded the allowed size');
      expect(errorBody.error).toBe('Payjoin response exceeded the allowed size');
      expect(validatePayjoinProposal).not.toHaveBeenCalled();
    });

    it('sanitizes non-Error transport failures', async () => {
      requestPinnedAddressMock.mockRejectedValueOnce('sensitive failure payload');

      const result = await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(result.error).toBe('Payjoin request failed');
      expect(result.error).not.toContain('sensitive');
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
      expect(result.error).toBe('Payjoin request failed');
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

    it.each([
      '::ffff:127.0.0.1',
      '::1',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '255.255.255.255',
      '2001:db8::1',
    ])('should classify %s as private/internal', (ip) => {
      expect(isPrivateIP(ip)).toBe(true);
    });

    it.each([
      '8.8.8.8',
      '172.15.255.255',
      '172.32.0.1',
      '192.167.1.1',
    ])('should classify %s as public IPv4', (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    });

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

    it('should reject Payjoin URLs containing credentials', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'https://user:pass@example.com/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('credentials');
      expect(global.fetch).not.toHaveBeenCalled();
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

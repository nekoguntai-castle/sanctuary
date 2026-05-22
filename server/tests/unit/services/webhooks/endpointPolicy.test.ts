import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDnsLookup } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup },
  lookup: mockDnsLookup,
}));

import { validateWebhookEndpointUrl } from '../../../../src/services/webhooks/endpointPolicy';

describe('webhook endpoint policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEBHOOK_ALLOWED_CIDRS;
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_ALLOW_HTTP;
  });

  it('resolves DNS hosts once and allows explicitly allowlisted HTTP hosts', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = ' webhook.test ';
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

    await expect(validateWebhookEndpointUrl('http://webhook.test/hook'))
      .resolves.toMatchObject({
        resolvedAddresses: ['93.184.216.34'],
      });
    expect(mockDnsLookup).toHaveBeenCalledWith('webhook.test', { all: true, verbatim: true });
  });

  it('allows HTTP globally only when the deployment opts in', async () => {
    process.env.WEBHOOK_ALLOW_HTTP = 'true';

    await expect(validateWebhookEndpointUrl('http://93.184.216.34/hook'))
      .resolves.toMatchObject({ resolvedAddresses: ['93.184.216.34'] });
  });

  it('rejects non-HTTP webhook protocols and DNS names resolving to private networks', async () => {
    await expect(validateWebhookEndpointUrl('ftp://93.184.216.34/hook'))
      .rejects.toThrow('HTTPS');

    mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.4', family: 4 }]);
    await expect(validateWebhookEndpointUrl('https://receiver.example/hook'))
      .rejects.toThrow('blocked network');

    mockDnsLookup.mockResolvedValueOnce([{ address: '999.999.999.999', family: 4 }]);
    await expect(validateWebhookEndpointUrl('https://invalid-address.example/hook'))
      .rejects.toThrow('blocked network');
  });

  it('blocks private IPv4 ranges unless the resolved address is allowlisted by CIDR', async () => {
    const blockedAddresses = [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '100.64.0.1',
      '0.0.0.0',
    ];

    for (const address of blockedAddresses) {
      await expect(validateWebhookEndpointUrl(`https://${address}/hook`))
        .rejects.toThrow(/blocked/);
    }

    process.env.WEBHOOK_ALLOWED_CIDRS = '0.0.0.0/0';
    await expect(validateWebhookEndpointUrl('http://10.1.2.3/hook'))
      .resolves.toMatchObject({ resolvedAddresses: ['10.1.2.3'] });
  });

  it('ignores malformed CIDR allowlist entries', async () => {
    process.env.WEBHOOK_ALLOWED_CIDRS = 'not-an-ip/24,999.168.0.0/24,192.168.0/24,192.168.0.0/not-a-prefix,192.168.0.0/33';

    await expect(validateWebhookEndpointUrl('https://192.168.5.10/hook'))
      .rejects.toThrow('blocked network');
  });

  it('blocks non-global and malformed IPv6 ranges', async () => {
    const blockedAddresses = [
      'fd00::10',
      '2001:db8::1',
      '2001:2::1',
      '2001:10::1',
      '::ffff:5db8:d822',
      '::',
    ];

    for (const address of blockedAddresses) {
      await expect(validateWebhookEndpointUrl(`https://[${address}]/hook`))
        .rejects.toThrow(/blocked|blocked network/);
    }
  });
});

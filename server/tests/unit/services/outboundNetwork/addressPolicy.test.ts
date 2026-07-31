import { describe, expect, it, vi } from 'vitest';
import {
  isGloballyRoutableAddress,
  requireGloballyRoutableAddresses,
  resolveAllAddresses,
  type AddressLookup,
} from '../../../../src/services/outboundNetwork/addressPolicy';

describe('outbound address policy', () => {
  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.0',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.0',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.0',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks non-global IPv4 %s', (address) => {
    expect(isGloballyRoutableAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.254',
  ])('allows global IPv4 boundary %s', (address) => {
    expect(isGloballyRoutableAddress(address)).toBe(true);
  });

  it.each([
    '::',
    '::1',
    'fc00::1',
    'fdff:ffff::1',
    'fe80::1',
    'febf::1',
    'ff00::1',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:1f:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:20::',
    '2001:2f:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db8::1',
    '2002::',
    '2002:7f00:1::',
    '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2620:4f:8000::',
    '2620:4f:8000:ffff:ffff:ffff:ffff:ffff',
    '3ffe::',
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3fff::',
    '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
  ])('blocks non-global IPv6 %s', (address) => {
    expect(isGloballyRoutableAddress(address)).toBe(false);
  });

  it.each([
    '2001:4860:4860::8888',
    '2001:30::1',
    '2003::1',
    '2606:4700:4700::1111',
    '2a00:1450:4009:80b::200e',
    '2606:4700:4700:0000:0000:0000:0000:1111',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('allows global IPv6 or mapped-global address %s', (address) => {
    expect(isGloballyRoutableAddress(address)).toBe(true);
  });

  it('resolves DNS exactly once with all/verbatim and preserves answer order', async () => {
    const lookup = vi.fn<AddressLookup>().mockResolvedValue([
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '1.1.1.1', family: 4 },
    ]);

    await expect(resolveAllAddresses('Receiver.Example', lookup)).resolves.toEqual([
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '1.1.1.1', family: 4 },
    ]);
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('receiver.example', {
      all: true,
      verbatim: true,
    });
  });

  it('rejects DNS result families that cannot be validated safely', async () => {
    const lookup = vi.fn<AddressLookup>().mockResolvedValue([
      { address: '93.184.216.35', family: 0 },
      { address: '93.184.216.34', family: 4 },
    ]);

    await expect(resolveAllAddresses('receiver.example', lookup))
      .rejects.toThrow('did not resolve');
  });

  it('rejects a mixed public/private DNS answer set', () => {
    expect(() => requireGloballyRoutableAddresses([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])).toThrow('blocked network');
  });
});

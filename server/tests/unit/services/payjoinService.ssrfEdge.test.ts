import { vi, Mock } from 'vitest';

const { dnsLookupMock, validatePayjoinProposalMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
  validatePayjoinProposalMock: vi.fn(),
}));

vi.mock('dns', () => ({
  default: { lookup: dnsLookupMock },
  lookup: dnsLookupMock,
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {},
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/services/bitcoin/psbtValidation', () => ({
  parsePsbt: vi.fn(),
  validatePsbtStructure: vi.fn(),
  validatePayjoinProposal: validatePayjoinProposalMock,
  getPsbtOutputs: vi.fn(),
  getPsbtInputs: vi.fn(),
  calculateFeeRate: vi.fn(),
  clonePsbt: vi.fn(),
}));

import { attemptPayjoinSend } from '../../../src/services/payjoinService';

global.fetch = vi.fn();

describe('Payjoin Service SSRF Edge Coverage', () => {
  const originalPsbt = 'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';
  const proposalPsbt = 'cHNidP8BAHECAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8CrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GhAnAAAAAAAAFgAUdpn98MqGxRdMa7mGg0HhZKSL0BMAAAAAAAAA';

  beforeEach(() => {
    vi.clearAllMocks();

    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '93.184.216.34', family: 4 });
    });

    validatePayjoinProposalMock.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      text: async () => proposalPsbt,
    });
  });

  it('rejects malformed URLs before any DNS/fetch call', async () => {
    const result = await attemptPayjoinSend(originalPsbt, 'not-a-valid-url', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid Payjoin URL format');
    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects private IPv4 addresses resolved by DNS', async () => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '10.10.10.10', family: 4 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 private addresses', async () => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '::ffff:10.0.0.8', family: 6 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects non-IPv4 DNS answers conservatively', async () => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '2001:db8::1', family: 6 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects IPv6 localhost address', async () => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '::1', family: 6 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects IPv4 loopback DNS answers', async () => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: '127.0.0.2', family: 4 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '172.16.5.4',
    '192.168.1.25',
    '169.254.169.254',
    '0.0.0.0',
    '255.255.255.255',
  ])('rejects additional private/reserved IPv4 range: %s', async (ip) => {
    dnsLookupMock.mockImplementation((_hostname: string, callback: (err: null, result: { address: string; family: number }) => void) => {
      callback(null, { address: ip, family: 4 });
    });

    const result = await attemptPayjoinSend(originalPsbt, 'https://merchant.example/payjoin', [0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

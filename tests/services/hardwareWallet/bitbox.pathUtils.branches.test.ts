import { beforeEach,describe,expect,it,vi } from 'vitest';

const { mockedConstants, mockFromBech32, mockFromBase58Check } = vi.hoisted(() => ({
  mockedConstants: {
    messages: {
      BTCScriptConfig_SimpleType: {
        P2WPKH: 0,
        P2WPKH_P2SH: 11,
        P2TR: 12,
      },
      BTCXPubType: {
        VPUB: 20,
        ZPUB: 21,
        UPUB: 22,
        YPUB: 23,
        TPUB: 24,
        XPUB: 25,
      },
      BTCCoin: {
        TBTC: 30,
        BTC: 31,
      },
      BTCOutputType: {
        P2WPKH: 40,
        P2WSH: 41,
        P2TR: 42,
        P2PKH: 43,
        P2SH: 44,
      },
    },
  },
  mockFromBech32: vi.fn(),
  mockFromBase58Check: vi.fn(),
}));

vi.mock('bitbox02-api', () => ({
  constants: mockedConstants,
}));

vi.mock('bitcoinjs-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bitcoinjs-lib')>();
  return {
    ...actual,
    address: {
      ...actual.address,
      fromBech32: mockFromBech32,
      fromBase58Check: mockFromBase58Check,
    },
  };
});

import * as bitcoin from 'bitcoinjs-lib';
import {
extractAccountPath,
getOutputType,
getCoin,
getSimpleType,
getXpubType,
} from '../../../src/services/hardwareWallet/adapters/bitbox/pathUtils';

describe('bitbox pathUtils branch coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps all supported explicit script types, including enum value zero', () => {
    expect(getSimpleType('p2wpkh')).toBe(0);
    expect(getSimpleType('p2sh-p2wpkh')).toBe(
      mockedConstants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH
    );
    expect(getSimpleType('p2tr')).toBe(
      mockedConstants.messages.BTCScriptConfig_SimpleType.P2TR
    );
  });

  it('maps BIP84, BIP49, and BIP86 account purposes', () => {
    expect(getSimpleType(undefined, "m/84'/0'/0'")).toBe(0);
    expect(getSimpleType(undefined, "m/49'/0'/0'")).toBe(
      mockedConstants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH
    );
    expect(getSimpleType(undefined, "m/86'/0'/0'")).toBe(
      mockedConstants.messages.BTCScriptConfig_SimpleType.P2TR
    );
  });

  it('rejects missing and unsupported simple types instead of guessing', () => {
    expect(() => getSimpleType(undefined, undefined)).toThrow('Unsupported BitBox02 script type');
    expect(() => getSimpleType(undefined, "m/44'/0'/0'")).toThrow(
      'Unsupported BitBox02 script type for path'
    );
    expect(() => getSimpleType('p2pkh')).toThrow('Unsupported BitBox02 script type: p2pkh');
  });

  it('rejects script/path disagreement for taproot', () => {
    expect(() => getSimpleType('p2wpkh', "m/86'/0'/0'")).toThrow(
      'script type disagrees'
    );
  });

  it.each([
    ['p2sh-p2wpkh', "m/84'/0'/0'"],
    ['p2tr', "m/84'/0'/0'"],
    ['p2tr', "m/49'/0'/0'"],
  ])('rejects %s disagreement with %s', (scriptType, path) => {
    expect(() => getSimpleType(scriptType, path)).toThrow('script type disagrees');
  });

  it('covers testnet xpub branches for 84/49/86 paths and default non-testnet branch', () => {
    expect(getXpubType("m/84'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.VPUB);
    expect(getXpubType("m/49'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.UPUB);
    expect(getXpubType("m/49'/0'/0'", false)).toBe(mockedConstants.messages.BTCXPubType.YPUB);
    expect(getXpubType("m/86'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.TPUB);
    expect(() => getXpubType("m/44'/0'/0'", false)).toThrow('Unsupported BitBox02 xpub path');
  });

  it('returns P2WPKH for version 0 bech32 addresses with 20-byte programs', () => {
    mockFromBech32.mockReturnValue({
      version: 0,
      prefix: 'bc',
      data: Buffer.alloc(20),
    });

    expect(getOutputType('bc1qexample', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2WPKH
    );
  });

  it('recognizes P2TR and P2SH output addresses', () => {
    mockFromBech32.mockReturnValueOnce({ version: 1, prefix: 'bc', data: Buffer.alloc(32) });
    expect(getOutputType('bc1ptaproot', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2TR
    );

    mockFromBech32.mockImplementationOnce(() => { throw new Error('not bech32'); });
    mockFromBase58Check.mockReturnValueOnce({ version: 5, hash: Buffer.alloc(20) });
    expect(getOutputType('3script', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2SH
    );
  });

  it('rejects malformed base58 payload lengths after both decoder paths run', () => {
    mockFromBech32.mockImplementationOnce(() => { throw new Error('not bech32'); });
    mockFromBase58Check.mockReturnValueOnce({ version: 0, hash: Buffer.alloc(19) });
    expect(() => getOutputType('malformed', bitcoin.networks.bitcoin)).toThrow(
      'Unsupported or invalid BitBox02 output address'
    );
  });

  it('labels an empty undecodable output address as missing', () => {
    mockFromBech32.mockImplementationOnce(() => { throw new Error('not bech32'); });
    mockFromBase58Check.mockImplementationOnce(() => { throw new Error('not base58'); });
    expect(() => getOutputType('', bitcoin.networks.bitcoin)).toThrow(
      'output address: missing'
    );
  });

  it('recognizes P2WSH and rejects invalid v0 programs', () => {
    mockFromBech32.mockReturnValueOnce({ version: 0, prefix: 'bc', data: Buffer.alloc(32) });
    expect(getOutputType('bc1qwsh', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2WSH
    );
    mockFromBech32.mockReturnValueOnce({ version: 0, prefix: 'bc', data: Buffer.alloc(21) });
    mockFromBase58Check.mockImplementationOnce(() => { throw new Error('not base58'); });
    expect(() => getOutputType('bc1qbad', bitcoin.networks.bitcoin)).toThrow(
      'Unsupported or invalid BitBox02 output address'
    );
  });

  it('rejects unsupported derivation coin types', () => {
    expect(() => getCoin("m/84'/2'/0'")).toThrow('Unsupported BitBox02 coin type');
  });

  it('falls back to default output type for unsupported bech32 and unknown base58 versions', () => {
    mockFromBech32.mockReturnValue({
      version: 2,
      prefix: 'bc',
      data: Buffer.alloc(32),
    });
    mockFromBase58Check.mockReturnValue({
      version: 250,
      hash: Buffer.alloc(20),
    });

    expect(() => getOutputType('unknown', bitcoin.networks.bitcoin)).toThrow(
      'Unsupported or invalid BitBox02 output address'
    );
  });

  it('returns normalized path unchanged when account path has fewer than four components', () => {
    expect(extractAccountPath("m/84'/0'")).toBe("m/84'/0'");
  });
});

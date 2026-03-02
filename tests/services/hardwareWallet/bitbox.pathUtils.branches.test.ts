import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

const { mockedConstants } = vi.hoisted(() => ({
  mockedConstants: {
    messages: {
      BTCScriptConfig_SimpleType: {
        P2WPKH: 10,
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
}));

vi.mock('bitbox02-api', () => ({
  constants: mockedConstants,
}));
import {
  extractAccountPath,
  getOutputType,
  getSimpleType,
  getXpubType,
} from '../../../services/hardwareWallet/adapters/bitbox/pathUtils';

describe('bitbox pathUtils branch coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults simple type when both scriptType and path are absent', () => {
    expect(getSimpleType(undefined, undefined)).toBe(
      mockedConstants.messages.BTCScriptConfig_SimpleType.P2WPKH
    );
  });

  it('covers testnet xpub branches for 84/49/86 paths and default non-testnet branch', () => {
    expect(getXpubType("m/84'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.VPUB);
    expect(getXpubType("m/49'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.UPUB);
    expect(getXpubType("m/49'/0'/0'", false)).toBe(mockedConstants.messages.BTCXPubType.YPUB);
    expect(getXpubType("m/86'/0'/0'", true)).toBe(mockedConstants.messages.BTCXPubType.TPUB);
    expect(getXpubType("m/44'/0'/0'", false)).toBe(mockedConstants.messages.BTCXPubType.XPUB);
  });

  it('returns P2WPKH for version 0 bech32 addresses with 20-byte programs', () => {
    vi.spyOn(bitcoin.address, 'fromBech32').mockReturnValue({
      version: 0,
      prefix: 'bc',
      data: Buffer.alloc(20),
    });

    expect(getOutputType('bc1qexample', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2WPKH
    );
  });

  it('falls back to default output type for unsupported bech32 and unknown base58 versions', () => {
    vi.spyOn(bitcoin.address, 'fromBech32').mockReturnValue({
      version: 2,
      prefix: 'bc',
      data: Buffer.alloc(32),
    });
    vi.spyOn(bitcoin.address, 'fromBase58Check').mockReturnValue({
      version: 250,
      hash: Buffer.alloc(20),
    });

    expect(getOutputType('unknown', bitcoin.networks.bitcoin)).toBe(
      mockedConstants.messages.BTCOutputType.P2WPKH
    );
  });

  it('returns normalized path unchanged when account path has fewer than four components', () => {
    expect(extractAccountPath("m/84'/0'")).toBe("m/84'/0'");
  });
});

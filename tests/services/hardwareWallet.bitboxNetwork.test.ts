import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

vi.mock('bitbox02-api', () => ({
  getKeypathFromString: (path: string) => path
    .replace(/^m\//, '')
    .split('/')
    .map((part) => Number.parseInt(part.replace(/[h']$/, ''), 10)),
  constants: {
    messages: {
      BTCScriptConfig_SimpleType: { P2WPKH: 1, P2WPKH_P2SH: 2, P2TR: 3 },
      BTCXPubType: { VPUB: 1, ZPUB: 2, UPUB: 3, YPUB: 4, TPUB: 5, XPUB: 6 },
      BTCCoin: { TBTC: 7, BTC: 8 },
      BTCOutputType: { P2WPKH: 9, P2WSH: 10, P2TR: 11, P2PKH: 12, P2SH: 13 },
    },
  },
}));

import { signPsbtWithBitBox } from '../../src/services/hardwareWallet/adapters/bitbox/signPsbt';

const GENERATOR_PUBKEY = Uint8Array.from([
  0x02, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0,
  0x62, 0x95, 0xce, 0x87, 0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d,
  0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16, 0xf8, 0x17, 0x98,
]);

describe('BitBox PSBT account network binding', () => {
  it('parses a real testnet PSBT with the coin-type-1 network before output classification', async () => {
    const network = bitcoin.networks.testnet;
    const script = Uint8Array.from([0x00, 0x14, ...new Uint8Array(20).fill(7)]);
    const address = bitcoin.address.fromOutputScript(script, network);
    expect(address.startsWith('tb1')).toBe(true);

    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: new Uint8Array(32).fill(1),
      index: 0,
      witnessUtxo: { script, value: 1_000n },
      bip32Derivation: [{
        masterFingerprint: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
        path: "m/84'/1'/0'/0/0",
        pubkey: GENERATOR_PUBKEY,
      }],
    });
    psbt.addOutput({ address, value: 900n });

    const btcSignSimple = vi.fn().mockResolvedValue([]);
    await expect(signPsbtWithBitBox(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/84'/1'/0'",
        inputPaths: ["m/84'/1'/0'/0/0"],
      },
      {
        api: { btcSignSimple },
        devicePath: 'test',
        product: 1,
        rootFingerprint: 'aabbccdd',
      },
    )).rejects.toThrow('0 signatures for 1 inputs');

    expect(btcSignSimple).toHaveBeenCalledOnce();
    const [coin, , , , outputs] = btcSignSimple.mock.calls[0];
    expect(coin).not.toBeUndefined();
    expect(outputs[0]).toMatchObject({ ours: false, value: '900' });
    expect(Buffer.from(outputs[0].payload)).toEqual(Buffer.alloc(20, 7));
  });
});

import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { decodeRawTransaction } from '../../../../../src/services/bitcoin/electrum/methods';

// Genesis block coinbase: one P2PK output, no witness.
const GENESIS_COINBASE_HEX =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

function segwitSpendHex(): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.setWitness(0, [Buffer.alloc(72, 2), Buffer.alloc(33, 3)]);
  tx.addOutput(Buffer.from(`0014${'ab'.repeat(20)}`, 'hex'), 50_000n);
  return tx.toHex();
}

describe('decodeRawTransaction hex fields', () => {
  it('encodes every output scriptPubKey as lowercase hex of the script bytes', () => {
    const decoded = decodeRawTransaction(GENESIS_COINBASE_HEX, 'mainnet');
    const script = Buffer.from(bitcoin.Transaction.fromHex(GENESIS_COINBASE_HEX).outs[0].script).toString('hex');

    expect(decoded.vout[0].scriptPubKey.hex).toBe(script);
    expect(decoded.vout[0].scriptPubKey.hex).toMatch(/^41[0-9a-f]+ac$/);
  });

  it('reports hash as the display-order hash of the full serialization (equal to txid without witness data)', () => {
    const legacy = decodeRawTransaction(GENESIS_COINBASE_HEX, 'mainnet');
    expect(legacy.hash).toBe(legacy.txid);

    const segwitHex = segwitSpendHex();
    const segwit = decodeRawTransaction(segwitHex, 'testnet3');
    const fullSerializationHash = Buffer.from(bitcoin.crypto.hash256(Buffer.from(segwitHex, 'hex'))).reverse().toString('hex');
    expect(segwit.hash).toBe(fullSerializationHash);
    expect(segwit.hash).not.toBe(segwit.txid);
    expect(segwit.vout[0].scriptPubKey.hex).toBe(`0014${'ab'.repeat(20)}`);
  });
});

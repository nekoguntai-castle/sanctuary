import * as bitcoin from 'bitcoinjs-lib';
import { getPSBTInfo, getPSBTInfoWithNetwork } from '../../../../src/services/bitcoin/psbtInfo';
import { mainnetAddresses, testnetAddresses } from '../../../fixtures/bitcoin';

describe('psbtInfo', () => {
  function makePsbtBase64(network: bitcoin.Network, outputAddress: string, includeOpReturn = false): string {
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: '11'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: Buffer.from('0014' + 'aa'.repeat(20), 'hex'),
        value: BigInt(100_000),
      },
    });
    psbt.addInput({
      hash: '22'.repeat(32),
      index: 1,
      // no witnessUtxo: ensures default value path is exercised
    });
    psbt.addOutput({
      address: outputAddress,
      value: BigInt(70_000),
    });
    if (includeOpReturn) {
      psbt.addOutput({
        script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('memo')]),
        value: BigInt(0),
      });
    }
    return psbt.toBase64();
  }

  it('parses PSBT info with default mainnet output decoding', () => {
    const psbtBase64 = makePsbtBase64(bitcoin.networks.bitcoin, mainnetAddresses.nativeSegwit[0]);
    const info = getPSBTInfo(psbtBase64);

    expect(info.inputs).toHaveLength(2);
    expect(info.inputs[0].value).toBe(100_000);
    expect(info.inputs[1].value).toBe(0);
    expect(info.outputs[0].address).toBe(mainnetAddresses.nativeSegwit[0]);
    expect(info.fee).toBe(30_000);
  });

  it('handles OP_RETURN outputs in default parser and leaves address undefined for them', () => {
    const psbtBase64 = makePsbtBase64(bitcoin.networks.testnet, testnetAddresses.nativeSegwit[0], true);
    const info = getPSBTInfo(psbtBase64);

    expect(info.outputs[0].address).toBeDefined();
    expect(info.outputs[1].address).toBeUndefined();
    expect(info.outputs[1].isChange).toBe(false);
  });

  it('parses network-aware output addresses on testnet and handles OP_RETURN output', () => {
    const psbtBase64 = makePsbtBase64(bitcoin.networks.testnet, testnetAddresses.nativeSegwit[0], true);
    const info = getPSBTInfoWithNetwork(psbtBase64, 'testnet3');

    expect(info.inputs[0].txid).toHaveLength(64);
    expect(info.outputs[0].address).toBe(testnetAddresses.nativeSegwit[0]);
    expect(info.outputs[1].address).toBeUndefined();
    expect(info.fee).toBe(30_000);
  });

  it('parses network-aware output addresses on mainnet', () => {
    const psbtBase64 = makePsbtBase64(bitcoin.networks.bitcoin, mainnetAddresses.nativeSegwit[0]);
    const info = getPSBTInfoWithNetwork(psbtBase64, 'mainnet');

    expect(info.outputs[0].address).toBe(mainnetAddresses.nativeSegwit[0]);
    expect(info.fee).toBe(30_000);
  });
});

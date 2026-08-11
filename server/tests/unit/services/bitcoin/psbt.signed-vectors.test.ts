import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import { GENERATED_SIGNED_PSBT_VECTORS } from '@fixtures/generated-signed-psbt-vectors';
import { finalizeMultisigInput } from '../../../../src/services/bitcoin/psbtBuilder';

bitcoin.initEccLib(ecc);

const NETWORK = bitcoin.networks.regtest;
const EXPECTED_SCRIPT_TYPES = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2wsh', 'p2sh-p2wsh'];
const MULTISIG_SCRIPT_TYPES = ['p2wsh', 'p2sh-p2wsh'];
type SignedVector = typeof GENERATED_SIGNED_PSBT_VECTORS[number];

function feeFromPsbt(psbt: bitcoin.Psbt): number {
  const inputTotal = psbt.data.inputs.reduce((total, input, index) => {
    if (input.witnessUtxo) return total + Number(input.witnessUtxo.value);
    if (!input.nonWitnessUtxo) throw new Error(`Missing prevout evidence for input ${index}`);
    const previous = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
    const output = previous.outs[psbt.txInputs[index].index];
    if (!output) throw new Error(`Missing previous output for input ${index}`);
    return total + Number(output.value);
  }, 0);
  const outputTotal = psbt.txOutputs.reduce((total, output) => total + Number(output.value), 0);
  return inputTotal - outputTotal;
}

function finalizeSignedFixture(psbt: bitcoin.Psbt, scriptType: string): bitcoin.Psbt {
  if (MULTISIG_SCRIPT_TYPES.includes(scriptType)) {
    finalizeMultisigInput(psbt, 0);
  } else {
    psbt.finalizeAllInputs();
  }
  return psbt;
}

function multisigFixture(scriptType: 'p2wsh' | 'p2sh-p2wsh') {
  const fixture = GENERATED_SIGNED_PSBT_VECTORS.find((vector) => vector.scriptType === scriptType);
  if (!fixture) {
    throw new Error(`Missing signed fixture: ${scriptType}`);
  }
  return fixture;
}

function corruptSignature(psbt: bitcoin.Psbt): void {
  const [partialSig] = psbt.data.inputs[0].partialSig ?? [];
  if (!partialSig) {
    throw new Error('Missing partial signature to corrupt');
  }
  const signature = Buffer.from(partialSig.signature);
  signature[signature.length - 2] ^= 0x01;
  partialSig.signature = signature;
}

function assertSignedVectorNetwork(vector: SignedVector, expectedNetwork: SignedVector['network']): void {
  if (vector.network !== expectedNetwork) {
    throw new Error(`Signed PSBT vector network mismatch: expected ${expectedNetwork}, got ${vector.network}`);
  }
}

describe('Generated Signed PSBT Vectors', () => {
  it('has Bitcoin Core-accepted signed vectors for every pre-hardware script family', () => {
    expect(GENERATED_SIGNED_PSBT_VECTORS.map((vector) => vector.scriptType)).toEqual(EXPECTED_SCRIPT_TYPES);
  });

  it('records Bitcoin Core acceptance and Sanctuary signing provenance', () => {
    GENERATED_SIGNED_PSBT_VECTORS.forEach((vector) => {
      expect(vector.mempoolAccept.allowed).toBe(true);
      expect(vector.verifiedBy.some((impl) => impl.includes('Bitcoin Core'))).toBe(true);
      expect(vector.verifiedBy.some((impl) => impl.includes('Sanctuary software signer'))).toBe(true);
    });
  });

  it('finalizes signed PSBT fixtures to the committed Bitcoin Core-accepted transaction hex', () => {
    GENERATED_SIGNED_PSBT_VECTORS.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });
      finalizeSignedFixture(psbt, vector.scriptType);

      expect(psbt.toBase64()).toBe(vector.finalizedPsbtBase64);
      expect(psbt.extractTransaction(true).toHex()).toBe(vector.finalTxHex);
    });
  });

  it('preserves expected txid, fee, and vsize invariants', () => {
    GENERATED_SIGNED_PSBT_VECTORS.forEach((vector) => {
      const unsignedPsbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64, { network: NETWORK });
      const tx = bitcoin.Transaction.fromHex(vector.finalTxHex);

      expect(feeFromPsbt(unsignedPsbt)).toBe(vector.expectedFee);
      expect(tx.getId()).toBe(vector.expectedTxid);
      expect(tx.virtualSize()).toBe(vector.expectedVsize);
      expect(vector.mempoolAccept.txid).toBe(vector.expectedTxid);
    });
  });

  it('keeps signed vectors on regtest-only addresses and scripts', () => {
    GENERATED_SIGNED_PSBT_VECTORS.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64, { network: NETWORK });

      psbt.txOutputs.forEach((output) => {
        const address = bitcoin.address.fromOutputScript(output.script, NETWORK);
        expect(address.startsWith('bcrt1')).toBe(true);
      });
    });
  });

  it('rejects corrupted multisig signatures before final extraction', () => {
    MULTISIG_SCRIPT_TYPES.forEach((scriptType) => {
      const vector = multisigFixture(scriptType as 'p2wsh' | 'p2sh-p2wsh');
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });
      corruptSignature(psbt);

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('signature verification failed');
      expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    });
  });

  it('rejects below-quorum multisig PSBTs before final extraction', () => {
    MULTISIG_SCRIPT_TYPES.forEach((scriptType) => {
      const vector = multisigFixture(scriptType as 'p2wsh' | 'p2sh-p2wsh');
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });
      psbt.data.inputs[0].partialSig = psbt.data.inputs[0].partialSig?.slice(0, 1);

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('has 1 signatures but needs exactly 2');
      expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    });
  });

  it('rejects wrong signer pubkey metadata before final extraction', () => {
    MULTISIG_SCRIPT_TYPES.forEach((scriptType) => {
      const vector = multisigFixture(scriptType as 'p2wsh' | 'p2sh-p2wsh');
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });
      psbt.data.inputs[0].bip32Derivation![0].pubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('missing BIP32 derivation metadata for signer pubkey');
      expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    });
  });

  it('rejects malformed signer derivation paths before final extraction', () => {
    MULTISIG_SCRIPT_TYPES.forEach((scriptType) => {
      const vector = multisigFixture(scriptType as 'p2wsh' | 'p2sh-p2wsh');
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });
      psbt.data.inputs[0].bip32Derivation![0].path = "m/48'/1'/0'/2'/0/notanumber";

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('invalid BIP32 path');
      expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    });
  });

  it('rejects output tampering after signatures are present', () => {
    MULTISIG_SCRIPT_TYPES.forEach((scriptType) => {
      const vector = multisigFixture(scriptType as 'p2wsh' | 'p2sh-p2wsh');
      const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64, { network: NETWORK });

      expect(() =>
        psbt.addOutput({ address: bitcoin.address.fromOutputScript(psbt.txOutputs[0].script, NETWORK), value: 1n })
      ).toThrow('Can not modify transaction, signatures exist');
      expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    });
  });

  it('rejects network mismatch before signed-vector replay', () => {
    GENERATED_SIGNED_PSBT_VECTORS.forEach((vector) => {
      expect(() => assertSignedVectorNetwork(vector, 'testnet' as SignedVector['network'])).toThrow(
        'Signed PSBT vector network mismatch'
      );
    });
  });
});

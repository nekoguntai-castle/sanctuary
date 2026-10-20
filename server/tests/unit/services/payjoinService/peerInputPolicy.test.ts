import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { witnessStackToScriptWitness } from '../../../../src/services/bitcoin/psbtBuilder';
import { assertPeerInputsWithinEstimate } from '../../../../src/services/payjoin/peerInputPolicy';

const P2WPKH = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
const P2TR = Buffer.from(`5120${'33'.repeat(32)}`, 'hex');
const P2SH = Buffer.from(`a914${'44'.repeat(20)}87`, 'hex');
const P2WSH = Buffer.from(`0020${'55'.repeat(32)}`, 'hex');
const bytes = (length: number, fill = 0x30) => Buffer.alloc(length, fill);
const witness = (...items: Buffer[]) => witnessStackToScriptWitness(items);

type PeerShape = {
  script?: Buffer;
  nonWitnessOnly?: boolean;
  finalScriptWitness?: Buffer;
  finalScriptSig?: Buffer;
};

/** A proposal with one wallet input (index 0) and one peer input (index 1). */
const proposalWithPeer = (peer: PeerShape): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: '11'.repeat(32), index: 0, sequence: 0xfffffffd, witnessUtxo: { script: P2WPKH, value: 10_000n } });
  const script = peer.script ?? P2WPKH;
  if (peer.nonWitnessOnly) {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(Buffer.from('6a', 'hex'), 0n);
    previous.addOutput(script, 2_000n);
    psbt.addInput({
      hash: previous.getId(), index: 1, sequence: 0xfffffffd, nonWitnessUtxo: previous.toBuffer(),
    });
  } else {
    psbt.addInput({ hash: '55'.repeat(32), index: 1, sequence: 0xfffffffd, witnessUtxo: { script, value: 2_000n } });
  }
  psbt.addOutput({ script: P2WPKH, value: 11_000n });
  psbt.updateInput(1, {
    ...(peer.finalScriptWitness && { finalScriptWitness: peer.finalScriptWitness }),
    ...(peer.finalScriptSig && { finalScriptSig: peer.finalScriptSig }),
  });
  return psbt;
};

const P2WPKH_WITNESS = witness(bytes(72), bytes(33, 0x02));
const P2TR_KEY_PATH_WITNESS = witness(bytes(64));

describe('assertPeerInputsWithinEstimate', () => {
  it.each([
    ['a P2WPKH witness', { finalScriptWitness: P2WPKH_WITNESS }],
    ['a maximum-size P2WPKH witness', { finalScriptWitness: witness(bytes(73), bytes(33, 0x02)) }],
    ['a P2TR key-path witness', { script: P2TR, finalScriptWitness: P2TR_KEY_PATH_WITNESS }],
    ['a P2TR key-path witness with a sighash byte', { script: P2TR, finalScriptWitness: witness(bytes(65)) }],
    ['a P2WPKH peer that carries only nonWitnessUtxo', { nonWitnessOnly: true, finalScriptWitness: P2WPKH_WITNESS }],
    ['an empty finalScriptSig beside the witness', { finalScriptWitness: P2WPKH_WITNESS, finalScriptSig: Buffer.alloc(0) }],
  ])('accepts %s within the fee-policy estimate', (_name, peer) => {
    expect(assertPeerInputsWithinEstimate(proposalWithPeer(peer), [1])).toBeNull();
  });

  it.each([
    ['a P2TR script-path witness heavier than the key-path estimate', { script: P2TR, finalScriptWitness: witness(bytes(64), bytes(34), bytes(33, 0xc0)) }, 'peer_input_witness_too_heavy'],
    ['an oversized P2WPKH witness', { finalScriptWitness: witness(bytes(73), bytes(65, 0x04)) }, 'peer_input_witness_too_heavy'],
    ['a non-empty finalScriptSig', { finalScriptWitness: P2WPKH_WITNESS, finalScriptSig: Buffer.from([0x00]) }, 'peer_input_final_script_sig'],
    ['a peer input with no finalScriptWitness', {}, 'peer_input_not_finalized'],
    ['a P2SH peer input', { script: P2SH, finalScriptWitness: P2WPKH_WITNESS }, 'peer_input_script_unsupported'],
    ['a P2WSH peer input', { script: P2WSH, finalScriptWitness: P2WPKH_WITNESS }, 'peer_input_script_unsupported'],
    ['a malformed witness', { finalScriptWitness: Buffer.from([0x05, 0x01]) }, 'peer_input_witness_malformed'],
  ])('refuses %s', (_name, peer, error) => {
    expect(assertPeerInputsWithinEstimate(proposalWithPeer(peer), [1])).toBe(error);
  });

  it('refuses a peer input without UTXO data', () => {
    const psbt = proposalWithPeer({ finalScriptWitness: P2WPKH_WITNESS });
    delete psbt.data.inputs[1].witnessUtxo;

    expect(assertPeerInputsWithinEstimate(psbt, [1])).toBe('peer_input_script_unsupported');
  });

  it('refuses a nonWitnessUtxo peer whose referenced output is missing', () => {
    const psbt = proposalWithPeer({ nonWitnessOnly: true, finalScriptWitness: P2WPKH_WITNESS });
    // Point the input at an output the previous transaction does not have.
    (psbt.data.globalMap.unsignedTx as unknown as { tx: bitcoin.Transaction }).tx.ins[1].index = 9;

    expect(assertPeerInputsWithinEstimate(psbt, [1])).toBe('peer_input_script_unsupported');
  });

  it('checks only the listed peer indexes', () => {
    const psbt = proposalWithPeer({ finalScriptWitness: P2WPKH_WITNESS });

    expect(assertPeerInputsWithinEstimate(psbt, [])).toBeNull();
  });
});

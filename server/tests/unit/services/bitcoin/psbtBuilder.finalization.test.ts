import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { finalizeMultisigInput } from "../../../../src/services/bitcoin/psbtBuilder";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const derLikeSignature = (): Buffer =>
  Buffer.concat([
    Buffer.from("30440220", "hex"),
    Buffer.alloc(32, 0x01),
    Buffer.from("0220", "hex"),
    Buffer.alloc(32, 0x02),
    Buffer.from([0x01]),
  ]);

describe("PSBT Builder multisig finalization", () => {
  it("should throw when witnessScript is missing", () => {
    const psbt = new bitcoin.Psbt({ network });
    const key = ECPair.makeRandom({ network });
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(key.publicKey),
      network,
    });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xaa),
      index: 0,
      witnessUtxo: { script: p2wpkh.output!, value: BigInt(100000) },
    });
    psbt.addOutput({ address: p2wpkh.address!, value: BigInt(90000) });

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "missing witnessScript",
    );
  });

  it("should throw when no partial signatures exist", () => {
    const psbt = new bitcoin.Psbt({ network });
    const keys = Array.from({ length: 2 }, () => ECPair.makeRandom({ network }));
    const pubkeys = keys.map((k) => Buffer.from(k.publicKey)).sort(Buffer.compare);
    const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys, network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xbb),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2ms.output!,
    });
    psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "no partial signatures",
    );
  });

  it("should throw when witnessScript is not a valid multisig script", () => {
    const psbt = new bitcoin.Psbt({ network });
    const key = ECPair.makeRandom({ network });
    const pubkey = Buffer.from(key.publicKey);
    const p2pkScript = bitcoin.script.compile([
      pubkey,
      bitcoin.opcodes.OP_CHECKSIG,
    ]);
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: { output: p2pkScript, network },
      network,
    });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xcc),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2pkScript,
    });
    psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });
    psbt.data.inputs[0].partialSig = [{ pubkey, signature: Buffer.alloc(72, 0x30) }];

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "not a valid multisig script",
    );
  });

  it("should throw when signature count does not match quorum", () => {
    const psbt = new bitcoin.Psbt({ network });
    const keys = Array.from({ length: 3 }, () => ECPair.makeRandom({ network }));
    const pubkeys = keys.map((k) => Buffer.from(k.publicKey)).sort(Buffer.compare);
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xdd),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2ms.output!,
    });
    psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });
    psbt.data.inputs[0].partialSig = [
      {
        pubkey: pubkeys[0],
        signature: Buffer.concat([
          Buffer.from("3045022100", "hex"),
          Buffer.alloc(32, 0x01),
          Buffer.from("0220", "hex"),
          Buffer.alloc(32, 0x02),
          Buffer.from([0x01]),
        ]),
      },
    ];

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "has 1 signatures but needs exactly 2",
    );
  });

  it("should throw when partial signatures do not match witnessScript pubkeys", () => {
    const psbt = new bitcoin.Psbt({ network });
    const scriptPubkey = Buffer.from(ECPair.makeRandom({ network }).publicKey);
    const wrongPubkey = Buffer.from(ECPair.makeRandom({ network }).publicKey);
    const p2ms = bitcoin.payments.p2ms({
      m: 1,
      pubkeys: [scriptPubkey],
      network,
    });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xef),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2ms.output!,
    });
    psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });
    psbt.data.inputs[0].partialSig = [
      { pubkey: wrongPubkey, signature: derLikeSignature() },
    ];

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "no matching signatures found",
    );
  });

  it("throws when signer derivation metadata is missing", () => {
    const key = ECPair.makeRandom({ network });
    const pubkey = Buffer.from(key.publicKey);
    const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
    const psbt = new bitcoin.Psbt({ network });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xab),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2ms.output!,
    });
    psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });
    psbt.data.inputs[0].partialSig = [{ pubkey, signature: derLikeSignature() }];

    expect(() => finalizeMultisigInput(psbt, 0)).toThrow(
      "missing BIP32 derivation metadata for signer verification",
    );
  });

  it("throws when signer master fingerprint is malformed", () => {
    const key = ECPair.makeRandom({ network });
    const pubkey = Buffer.from(key.publicKey);
    const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
    const fakePsbt = {
      data: {
        inputs: [{
          witnessScript: p2ms.output!,
          witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
          bip32Derivation: [{
            masterFingerprint: Buffer.alloc(3, 1),
            path: "m/48'/1'/0'/2'/0/0",
            pubkey,
          }],
          partialSig: [{ pubkey, signature: derLikeSignature() }],
        }],
        globalMap: { unsignedTx: { toBuffer: () => new bitcoin.Transaction().toBuffer() } },
      },
      updateInput: vi.fn(),
    } as unknown as bitcoin.Psbt;

    expect(() => finalizeMultisigInput(fakePsbt, 0)).toThrow(
      "invalid master fingerprint",
    );
  });

  it("throws when witnessUtxo is missing before signature verification", () => {
    const key = ECPair.makeRandom({ network });
    const pubkey = Buffer.from(key.publicKey);
    const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
    const fakePsbt = {
      data: {
        inputs: [{
          witnessScript: p2ms.output!,
          bip32Derivation: [{
            masterFingerprint: Buffer.alloc(4, 1),
            path: "m/48'/1'/0'/2'/0/0",
            pubkey,
          }],
          partialSig: [{ pubkey, signature: Buffer.from([0x01]) }],
        }],
        globalMap: { unsignedTx: { toBuffer: () => new bitcoin.Transaction().toBuffer() } },
      },
      updateInput: vi.fn(),
    } as unknown as bitcoin.Psbt;

    expect(() => finalizeMultisigInput(fakePsbt, 0)).toThrow(
      "missing witnessUtxo",
    );
    expect((fakePsbt as any).updateInput).not.toHaveBeenCalled();
  });

  it("throws when matching partial signatures fail ECDSA verification", () => {
    const key = ECPair.makeRandom({ network });
    const pubkey = Buffer.from(key.publicKey);
    const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
    const signatureWithHashType = Buffer.concat([
      Buffer.from([0x30, 0x26, 0x02, 0x01, 0x01, 0x02, 0x21, 0x00]),
      Buffer.alloc(32, 0x02),
      Buffer.from([0x01]),
    ]);
    const fakePsbt = {
      data: {
        inputs: [{
          witnessScript: p2ms.output!,
          witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
          bip32Derivation: [{
            masterFingerprint: Buffer.alloc(4, 1),
            path: "m/48'/1'/0'/2'/0/0",
            pubkey,
          }],
          partialSig: [{ pubkey, signature: signatureWithHashType }],
        }],
        globalMap: { unsignedTx: { toBuffer: () => new bitcoin.Transaction().toBuffer() } },
      },
      updateInput: vi.fn(),
    } as unknown as bitcoin.Psbt;

    expect(() => finalizeMultisigInput(fakePsbt, 0)).toThrow(
      "signature verification failed",
    );
    expect((fakePsbt as any).updateInput).not.toHaveBeenCalled();
  });

  it("should finalize and extract when valid signatures match quorum", () => {
    const psbt = new bitcoin.Psbt({ network });
    const keys = Array.from({ length: 2 }, () => ECPair.makeRandom({ network }));
    const pubkeys = keys.map((k) => Buffer.from(k.publicKey)).sort(Buffer.compare);
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
    const destination = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(ECPair.makeRandom({ network }).publicKey),
      network,
    });

    psbt.addInput({
      hash: Buffer.alloc(32, 0xee),
      index: 0,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
      witnessScript: p2ms.output!,
      bip32Derivation: pubkeys.map((pubkey, index) => ({
        masterFingerprint: Buffer.alloc(4, index + 1),
        path: `m/48'/1'/0'/2'/0/${index}`,
        pubkey,
      })),
    });
    psbt.addOutput({ address: destination.address!, value: BigInt(90000) });

    keys.forEach((key) => psbt.signInput(0, key));
    expect(psbt.data.inputs[0].partialSig).toHaveLength(2);
    expect(() => finalizeMultisigInput(psbt, 0)).not.toThrow();
    expect(psbt.data.inputs[0].finalScriptWitness).toBeInstanceOf(Buffer);
    expect(psbt.extractTransaction(true).ins[0].witness).toHaveLength(4);
  });
});

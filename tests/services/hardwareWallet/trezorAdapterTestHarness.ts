import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import bs58check from 'bs58check';

const bip32 = BIP32Factory(ecc);

/** Convert hex to Uint8Array (bitcoinjs-lib v7 requires Uint8Array, not Buffer, in jsdom) */
export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export const originalWindow = globalThis.window;

export function setSecureContext(value: boolean) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...originalWindow,
      isSecureContext: value,
      location: { origin: 'https://example.test' },
    },
    configurable: true,
  });
}

export function slip132Key(versionHex: string): string {
  const payload = Buffer.alloc(78, 1);
  Buffer.from(versionHex, 'hex').copy(payload, 0);
  return bs58check.encode(payload);
}

export function createSingleSigPsbt({
  inputPath = "m/84'/0'/0'/0/0",
  includeBip32Derivation = true,
  fingerprintHex = 'deadbeef',
}: {
  inputPath?: string;
  includeBip32Derivation?: boolean;
  fingerprintHex?: string;
} = {}) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  const inputPubkey = hexToBytes(`02${'11'.repeat(32)}`);
  const inputScript = hexToBytes(`0014${'11'.repeat(20)}`);
  const refTxHex = createRefTxHex(60000, inputScript);
  const refTxid = bitcoin.Transaction.fromHex(refTxHex).getId();

  const input: any = {
    hash: refTxid,
    index: 0,
    sequence: 0xffffffff,
    nonWitnessUtxo: bitcoin.Transaction.fromHex(refTxHex).toBuffer(),
    witnessUtxo: {
      script: inputScript,
      value: BigInt(60000),
    },
  };

  if (includeBip32Derivation) {
    input.bip32Derivation = [
      {
        masterFingerprint: hexToBytes(fingerprintHex),
        path: inputPath,
        pubkey: inputPubkey,
      },
    ];
  }

  psbt.addInput(input);
  psbt.addOutput({
    script: hexToBytes(`0014${'22'.repeat(20)}`),
    value: BigInt(59000),
  });

  return { psbt, inputScript, refTxHex };
}

export function createMultisigPsbt(includeDeviceCosigner = true) {
  const deviceFingerprint = includeDeviceCosigner ? 'deadbeef' : 'cccccccc';
  const deviceAccount = bip32.fromSeed(hexToBytes('11'.repeat(32))).derivePath("m/48'/0'/0'/2'");
  const cosignerAccount = bip32.fromSeed(hexToBytes('22'.repeat(32))).derivePath("m/48'/0'/0'/2'");
  const derivations = (branch: number, index: number) =>
    [
      {
        masterFingerprint: hexToBytes(deviceFingerprint),
        path: `m/48'/0'/0'/2'/${branch}/${index}`,
        pubkey: Uint8Array.from(deviceAccount.derive(branch).derive(index).publicKey),
      },
      {
        masterFingerprint: hexToBytes('aaaaaaaa'),
        path: `m/48'/0'/0'/2'/${branch}/${index}`,
        pubkey: Uint8Array.from(cosignerAccount.derive(branch).derive(index).publicKey),
      },
    ].sort((left, right) => Buffer.compare(Buffer.from(left.pubkey), Buffer.from(right.pubkey)));
  const inputDerivations = derivations(0, 1);
  const changeDerivations = derivations(1, 0);
  const scriptFor = (origins: ReturnType<typeof derivations>) =>
    Uint8Array.from([0x52, 0x21, ...origins[0].pubkey, 0x21, ...origins[1].pubkey, 0x52, 0xae]);
  const witnessScript = scriptFor(inputDerivations);
  const changeWitnessScript = scriptFor(changeDerivations);
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript } });
  const changeP2wsh = bitcoin.payments.p2wsh({
    redeem: { output: changeWitnessScript },
  });

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  const refTxHex = createRefTxHex(100000, p2wsh.output!);
  psbt.addInput({
    hash: bitcoin.Transaction.fromHex(refTxHex).getId(),
    index: 0,
    nonWitnessUtxo: bitcoin.Transaction.fromHex(refTxHex).toBuffer(),
    witnessUtxo: {
      script: p2wsh.output!,
      value: BigInt(100000),
    },
    witnessScript,
    bip32Derivation: inputDerivations,
  });
  psbt.addOutput({
    script: hexToBytes(`0014${'33'.repeat(20)}`),
    value: BigInt(90000),
  });
  psbt.addOutput({
    script: changeP2wsh.output!,
    value: BigInt(9000),
    witnessScript: changeWitnessScript,
    bip32Derivation: changeDerivations,
  });

  return {
    psbt,
    witnessScript,
    multisigXpubs: {
      [deviceFingerprint]: deviceAccount.neutered().toBase58(),
      aaaaaaaa: cosignerAccount.neutered().toBase58(),
    },
  };
}

export function unsignedTxHexFromPsbt(psbt: bitcoin.Psbt): string {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(psbtTx.toBuffer()).toHex();
}

export function createSignedMultisigTxHex(psbt: bitcoin.Psbt, witnessScript: Uint8Array): string {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  const tx = bitcoin.Transaction.fromBuffer(psbtTx.toBuffer());
  const signature = Buffer.from(
    '30440220010203040506070809000102030405060708090001020304050607080900010202200102030405060708090001020304050607080900010203040506070809000101',
    'hex'
  );
  tx.ins[0].witness = [Buffer.alloc(0), signature, witnessScript];
  return tx.toHex();
}

export function createRefTxHex(amount: number, script: Uint8Array): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(new Uint8Array(32).fill(2), 0, 0xfffffffd, new Uint8Array(0));
  tx.addOutput(script, BigInt(amount));
  return tx.toHex();
}

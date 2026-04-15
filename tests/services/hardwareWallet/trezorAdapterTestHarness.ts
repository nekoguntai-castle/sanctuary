import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';

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

  const input: any = {
    hash: '11'.repeat(32),
    index: 0,
    sequence: 0xffffffff,
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

  return { psbt, inputScript };
}

export function createMultisigPsbt(includeDeviceCosigner = true) {
  const devicePubkey = hexToBytes(`02${'11'.repeat(32)}`);
  const cosignerPubkey = hexToBytes(`03${'22'.repeat(32)}`);
  const deviceFingerprint = includeDeviceCosigner ? 'deadbeef' : 'cccccccc';

  const witnessScript = new Uint8Array([
    0x52, 0x21, ...devicePubkey, 0x21, ...cosignerPubkey, 0x52, 0xae,
  ]);
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript } });

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 1,
    witnessUtxo: {
      script: p2wsh.output!,
      value: BigInt(100000),
    },
    witnessScript,
    bip32Derivation: [
      {
        masterFingerprint: hexToBytes(deviceFingerprint),
        path: "m/48'/0'/0'/2'/0/1",
        pubkey: devicePubkey,
      },
      {
        masterFingerprint: hexToBytes('aaaaaaaa'),
        path: "m/48'/0'/0'/2'/0/1",
        pubkey: cosignerPubkey,
      },
    ],
  });
  psbt.addOutput({
    script: hexToBytes(`0014${'33'.repeat(20)}`),
    value: BigInt(90000),
  });
  psbt.addOutput({
    script: p2wsh.output!,
    value: BigInt(9000),
    witnessScript,
    bip32Derivation: [
      {
        masterFingerprint: hexToBytes(deviceFingerprint),
        path: "m/48'/0'/0'/2'/1/0",
        pubkey: devicePubkey,
      },
      {
        masterFingerprint: hexToBytes('aaaaaaaa'),
        path: "m/48'/0'/0'/2'/1/0",
        pubkey: cosignerPubkey,
      },
    ],
  });

  return { psbt, witnessScript, devicePubkey };
}

export function unsignedTxHexFromPsbt(psbt: bitcoin.Psbt): string {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  return bitcoin.Transaction.fromBuffer(psbtTx.toBuffer()).toHex();
}

export function createSignedMultisigTxHex(psbt: bitcoin.Psbt, witnessScript: Uint8Array): string {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
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

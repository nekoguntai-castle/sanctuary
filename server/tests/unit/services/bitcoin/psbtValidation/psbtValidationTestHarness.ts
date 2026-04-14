import { vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

export const TESTNET = bitcoin.networks.testnet;
export const MAINNET = bitcoin.networks.bitcoin;

export const TEST_ADDRESS_TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
export const TEST_ADDRESS_MAINNET = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

export function createTestPsbt(options: {
  network?: bitcoin.Network;
  inputCount?: number;
  outputCount?: number;
  inputValues?: number[];
  outputValues?: number[];
  sequence?: number;
  addWitnessUtxo?: boolean;
} = {}): bitcoin.Psbt {
  const network = options.network || TESTNET;
  const inputCount = options.inputCount ?? 1;
  const outputCount = options.outputCount ?? 1;
  const inputValues = options.inputValues || Array(inputCount).fill(100000);
  const outputValues = options.outputValues || Array(outputCount).fill(50000);
  const sequence = options.sequence ?? 0xfffffffd;
  const addWitnessUtxo = options.addWitnessUtxo ?? true;

  const psbt = new bitcoin.Psbt({ network });

  const createTxidHash = (index: number) => {
    const hex = index.toString(16).padStart(64, 'a');
    return Buffer.from(hex, 'hex');
  };

  for (let i = 0; i < inputCount; i++) {
    const input: bitcoin.PsbtTxInput = {
      hash: createTxidHash(i),
      index: 0,
      sequence,
    };

    psbt.addInput(input);

    if (addWitnessUtxo) {
      const outputScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, i + 1),
        network,
      }).output!;

      psbt.updateInput(i, {
        witnessUtxo: {
          script: outputScript,
          value: BigInt(inputValues[i] || 100000),
        },
      });
    }
  }

  for (let i = 0; i < outputCount; i++) {
    const outputScript = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, i + 0x10),
      network,
    }).output!;

    psbt.addOutput({
      script: outputScript,
      value: BigInt(outputValues[i] || 50000),
    });
  }

  return psbt;
}

export function createNonWitnessPsbt(options: {
  inputValue?: number;
  outputValue?: number;
  seed?: number;
} = {}): bitcoin.Psbt {
  const inputValue = options.inputValue ?? 100000;
  const outputValue = options.outputValue ?? 90000;
  const seed = options.seed ?? 1;

  const previousTx = new bitcoin.Transaction();
  previousTx.addInput(Buffer.alloc(32, seed), 0xffffffff, 0xfffffffd, Buffer.alloc(0));
  previousTx.addOutput(
    bitcoin.payments.p2pkh({
      hash: Buffer.alloc(20, seed),
      network: TESTNET,
    }).output!,
    BigInt(inputValue)
  );

  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.addInput({
    hash: Buffer.from(previousTx.getId(), 'hex').reverse(),
    index: 0,
    sequence: 0xfffffffd,
    nonWitnessUtxo: previousTx.toBuffer(),
  });
  psbt.addOutput({
    script: bitcoin.payments.p2pkh({
      hash: Buffer.alloc(20, 0x20 + seed),
      network: TESTNET,
    }).output!,
    value: BigInt(outputValue),
  });

  return psbt;
}

export function createOpReturnPsbt(seed: number = 1): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.addInput({
    hash: Buffer.alloc(32, seed),
    index: 0,
    sequence: 0xfffffffd,
  });
  psbt.updateInput(0, {
    witnessUtxo: {
      script: bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, seed),
        network: TESTNET,
      }).output!,
      value: BigInt(100000),
    },
  });
  psbt.addOutput({
    script: Buffer.from([0x6a, 0x01, seed]),
    value: BigInt(0),
  });

  return psbt;
}

import { beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getBlockHeight: vi.fn().mockResolvedValue(850000),
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001...'),
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
  }),
}));

export {
  bitcoin,
};

export {
  validatePsbtStructure,
  validatePayjoinProposal,
  getPsbtOutputs,
  getPsbtInputs,
  calculateFeeRate,
  isRbfEnabled,
  clonePsbt,
} from '../../../../src/services/bitcoin/psbtValidation';

export {
  parseBip21Uri,
  generateBip21Uri,
} from '../../../../src/services/payjoinService';

export const TESTNET = bitcoin.networks.testnet;
export const TEST_ADDRESS_RECEIVER = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
export const TEST_PAYJOIN_URL = 'https://example.com/api/v1/payjoin/receiver-addr';

export function createRealisticPsbt(options: {
  senderInputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address?: string; value: number }>;
  network?: bitcoin.Network;
}): bitcoin.Psbt {
  const network = options.network || TESTNET;
  const psbt = new bitcoin.Psbt({ network });

  for (const input of options.senderInputs) {
    const hash = Buffer.from(input.txid, 'hex').reverse();
    psbt.addInput({
      hash,
      index: input.vout,
      sequence: 0xfffffffd,
    });

    psbt.updateInput(psbt.inputCount - 1, {
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, psbt.inputCount),
          network,
        }).output!,
        value: BigInt(input.value),
      },
    });
  }

  for (const output of options.outputs) {
    if (output.address) {
      try {
        psbt.addOutput({
          address: output.address,
          value: BigInt(output.value),
        });
      } catch {
        psbt.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network,
          }).output!,
          value: BigInt(output.value),
        });
      }
    } else {
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, psbt.txOutputs.length + 0x10),
          network,
        }).output!,
        value: BigInt(output.value),
      });
    }
  }

  return psbt;
}

export const setupPayjoinIntegrationHarness = () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });
};

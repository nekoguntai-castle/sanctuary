import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import { ConflictError, InvalidInputError, InvalidPsbtError } from '../../../src/errors';

const {
  mockFindAddressStrings,
  mockFindByOutpointsForWallet,
  mockFindDeviceById,
  mockFindWalletById,
} = vi.hoisted(() => ({
  mockFindAddressStrings: vi.fn(),
  mockFindByOutpointsForWallet: vi.fn(),
  mockFindDeviceById: vi.fn(),
  mockFindWalletById: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  addressRepository: {
    findAddressStrings: mockFindAddressStrings,
  },
  deviceRepository: {
    findById: mockFindDeviceById,
  },
  utxoRepository: {
    findByOutpointsForWallet: mockFindByOutpointsForWallet,
  },
  walletRepository: {
    findById: mockFindWalletById,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { validateAgentFundingDraftSubmission } from '../../../src/services/agentFundingDraftValidation';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const FUNDING_WALLET_ID = 'funding-wallet';
const OPERATIONAL_WALLET_ID = 'operational-wallet';
const SIGNER_DEVICE_ID = 'agent-device';
const AGENT_FINGERPRINT = 'aabbccdd';
const HUMAN_FINGERPRINT = '11223344';
const TXID = '11'.repeat(32);

interface Fixture {
  psbtBase64: string;
  signedPsbtBase64: string;
  recipientAddress: string;
  changeAddress: string;
  fundingAddress: string;
}

interface FixtureOptions {
  foreignOutput?: boolean;
  signWith?: 'agent' | 'human';
}

describe('agentFundingDraftValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts an agent-signed PSBT that spends funding UTXOs to the operational wallet plus funding change', async () => {
    const fixture = buildFixture();
    setupRepositoryMocks(fixture);

    const result = await validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    });

    expect(result).toMatchObject({
      recipient: fixture.recipientAddress,
      amount: '80000',
      selectedUtxoIds: [`${TXID}:0`],
      fee: '5000',
      totalInput: '100000',
      totalOutput: '95000',
      changeAmount: '15000',
      changeAddress: fixture.changeAddress,
      effectiveAmount: '80000',
      enableRBF: false,
      inputPaths: ["m/48'/1'/0'/2'/0/0"],
    });
    expect(result.inputs).toEqual([
      {
        txid: TXID,
        vout: 0,
        address: fixture.fundingAddress,
        amount: 100000,
      },
    ]);
    expect(result.outputs).toEqual([
      { address: fixture.recipientAddress, amount: 80000 },
      { address: fixture.changeAddress, amount: 15000 },
    ]);
  });

  it('rejects outputs outside the linked operational wallet and funding wallet change addresses', async () => {
    const fixture = buildFixture({ foreignOutput: true });
    setupRepositoryMocks(fixture);

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow(InvalidPsbtError);
  });

  it('rejects already-spent funding wallet UTXOs', async () => {
    const fixture = buildFixture();
    setupRepositoryMocks(fixture, {
      utxo: {
        spent: true,
      },
    });

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow('already-spent');
  });

  it('rejects UTXOs already locked by another active draft', async () => {
    const fixture = buildFixture();
    setupRepositoryMocks(fixture, {
      utxo: {
        draftLock: { draftId: 'other-draft' },
      },
    });

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow(ConflictError);
  });

  it('rejects a PSBT that is not signed by the registered agent signer fingerprint', async () => {
    const fixture = buildFixture({ signWith: 'human' });
    setupRepositoryMocks(fixture);

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow('registered agent signer');
  });

  it('rejects mismatched declared amount metadata', async () => {
    const fixture = buildFixture();
    setupRepositoryMocks(fixture);

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: OPERATIONAL_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 70000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow(InvalidInputError);
  });
});

function setupRepositoryMocks(
  fixture: Fixture,
  overrides: {
    utxo?: Partial<{
      spent: boolean;
      frozen: boolean;
      draftLock: { draftId: string } | null;
    }>;
  } = {}
): void {
  mockFindWalletById.mockImplementation(async (walletId: string) => {
    if (walletId === FUNDING_WALLET_ID) {
      return {
        id: FUNDING_WALLET_ID,
        type: 'multi_sig',
        network: 'testnet',
      };
    }
    if (walletId === OPERATIONAL_WALLET_ID) {
      return {
        id: OPERATIONAL_WALLET_ID,
        type: 'single_sig',
        network: 'testnet',
      };
    }
    return null;
  });
  mockFindDeviceById.mockResolvedValue({
    id: SIGNER_DEVICE_ID,
    fingerprint: AGENT_FINGERPRINT,
  });
  mockFindAddressStrings.mockImplementation(async (walletId: string) => {
    if (walletId === FUNDING_WALLET_ID) {
      return [fixture.changeAddress];
    }
    if (walletId === OPERATIONAL_WALLET_ID) {
      return [fixture.recipientAddress];
    }
    return [];
  });
  mockFindByOutpointsForWallet.mockResolvedValue([
    {
      id: 'utxo-1',
      txid: TXID,
      vout: 0,
      address: fixture.fundingAddress,
      amount: 100000n,
      spent: false,
      frozen: false,
      draftLock: null,
      ...overrides.utxo,
    },
  ]);
}

function buildFixture(options: FixtureOptions = {}): Fixture {
  const agentKey = ECPair.fromPrivateKey(Buffer.alloc(32, 1));
  const humanKey = ECPair.fromPrivateKey(Buffer.alloc(32, 2));
  const agentPubkey = Buffer.from(agentKey.publicKey);
  const humanPubkey = Buffer.from(humanKey.publicKey);
  const pubkeys = [agentPubkey, humanPubkey].sort(Buffer.compare);
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

  const recipientAddress = bitcoin.payments.p2wpkh({
    hash: Buffer.alloc(20, 1),
    network,
  }).address!;
  const changeAddress = bitcoin.payments.p2wpkh({
    hash: Buffer.alloc(20, 2),
    network,
  }).address!;
  const foreignAddress = bitcoin.payments.p2wpkh({
    hash: Buffer.alloc(20, 3),
    network,
  }).address!;

  const psbt = new bitcoin.Psbt({ network });
  addFundingInput(psbt, p2wsh, p2ms, agentPubkey, humanPubkey);

  psbt.addOutput({ address: recipientAddress, value: 80000n });
  psbt.addOutput({
    address: options.foreignOutput ? foreignAddress : changeAddress,
    value: 15000n,
  });

  const psbtBase64 = psbt.toBase64();
  const signedPsbt = psbt.clone();
  const signingKey = options.signWith === 'human' ? humanKey : agentKey;
  for (let inputIndex = 0; inputIndex < signedPsbt.inputCount; inputIndex++) {
    signedPsbt.signInput(inputIndex, signingKey);
  }

  return {
    psbtBase64,
    signedPsbtBase64: signedPsbt.toBase64(),
    recipientAddress,
    changeAddress,
    fundingAddress: p2wsh.address!,
  };
}

function addFundingInput(
  psbt: bitcoin.Psbt,
  p2wsh: bitcoin.Payment,
  p2ms: bitcoin.Payment,
  agentPubkey: Buffer,
  humanPubkey: Buffer
): void {
  psbt.addInput({
    hash: TXID,
    index: 0,
    witnessUtxo: {
      script: p2wsh.output!,
      value: 100000n,
    },
    witnessScript: p2ms.output!,
    bip32Derivation: [
      {
        masterFingerprint: Buffer.from(AGENT_FINGERPRINT, 'hex'),
        pubkey: agentPubkey,
        path: "m/48'/1'/0'/2'/0/0",
      },
      {
        masterFingerprint: Buffer.from(HUMAN_FINGERPRINT, 'hex'),
        pubkey: humanPubkey,
        path: "m/48'/1'/0'/2'/0/0",
      },
    ],
  });
}

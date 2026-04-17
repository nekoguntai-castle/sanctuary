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
const TXID_ALT = '22'.repeat(32);

interface Fixture {
  psbtBase64: string;
  signedPsbtBase64: string;
  recipientAddress: string;
  changeAddress: string;
  fundingAddress: string;
}

interface FixtureOptions {
  foreignOutput?: boolean;
  nonstandardOutput?: boolean;
  noOutputs?: boolean;
  omitChangeOutput?: boolean;
  extraInput?: boolean;
  recipientValue?: bigint;
  changeValue?: bigint;
  sequence?: number;
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

  it('rejects invalid wallet/device relationships before parsing PSBTs', async () => {
    const fixture = buildFixture();

    await expect(validateAgentFundingDraftSubmission({
      fundingWalletId: FUNDING_WALLET_ID,
      operationalWalletId: FUNDING_WALLET_ID,
      signerDeviceId: SIGNER_DEVICE_ID,
      recipient: fixture.recipientAddress,
      amount: 80000,
      psbtBase64: fixture.psbtBase64,
      signedPsbtBase64: fixture.signedPsbtBase64,
    })).rejects.toThrow('must be different');

    setupRepositoryMocks(fixture);
    mockFindWalletById.mockImplementationOnce(async () => null);
    await expect(validSubmission(fixture)).rejects.toThrow('Funding wallet not found');

    setupRepositoryMocks(fixture);
    mockFindWalletById
      .mockResolvedValueOnce({ id: FUNDING_WALLET_ID, type: 'multi_sig', network: 'testnet' })
      .mockResolvedValueOnce(null);
    await expect(validSubmission(fixture)).rejects.toThrow('Operational wallet not found');

    setupRepositoryMocks(fixture);
    mockFindDeviceById.mockResolvedValueOnce(null);
    await expect(validSubmission(fixture)).rejects.toThrow('Signer device not found');

    setupRepositoryMocks(fixture);
    mockFindWalletById.mockImplementation(async (walletId: string) => {
      if (walletId === FUNDING_WALLET_ID) {
        return { id: FUNDING_WALLET_ID, type: 'single_sig', network: 'testnet' };
      }
      return { id: OPERATIONAL_WALLET_ID, type: 'single_sig', network: 'testnet' };
    });
    await expect(validSubmission(fixture)).rejects.toThrow('must be a multisig wallet');

    setupRepositoryMocks(fixture);
    mockFindWalletById.mockImplementation(async (walletId: string) => {
      if (walletId === FUNDING_WALLET_ID) {
        return { id: FUNDING_WALLET_ID, type: 'multi_sig', network: 'testnet' };
      }
      return { id: OPERATIONAL_WALLET_ID, type: 'single_sig', network: 'mainnet' };
    });
    await expect(validSubmission(fixture)).rejects.toThrow('same network');
  });

  it('rejects unsupported networks, malformed fingerprints, malformed amounts, and malformed PSBTs', async () => {
    const fixture = buildFixture();

    setupRepositoryMocks(fixture);
    mockFindWalletById.mockImplementation(async (walletId: string) => {
      if (walletId === FUNDING_WALLET_ID) {
        return { id: FUNDING_WALLET_ID, type: 'multi_sig', network: 'signet' };
      }
      return { id: OPERATIONAL_WALLET_ID, type: 'single_sig', network: 'signet' };
    });
    await expect(validSubmission(fixture)).rejects.toThrow('Unsupported wallet network');

    setupRepositoryMocks(fixture);
    mockFindDeviceById.mockResolvedValueOnce({ id: SIGNER_DEVICE_ID, fingerprint: 'not-hex' });
    await expect(validSubmission(fixture)).rejects.toThrow('fingerprint');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, { amount: '  not-sats  ' })).rejects.toThrow('amount must be');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, { amount: -1 })).rejects.toThrow('amount must be');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, { psbtBase64: 'not-a-psbt' })).rejects.toThrow('psbtBase64 is not a valid PSBT');
  });

  it('accepts string satoshi amounts and funding-only change omission', async () => {
    const fixture = buildFixture({ omitChangeOutput: true });
    setupRepositoryMocks(fixture);

    const result = await validSubmission(fixture, {
      amount: ' 80000 ',
    });

    expect(result).toMatchObject({
      amount: '80000',
      changeAmount: '0',
      changeAddress: undefined,
      fee: '20000',
    });
  });

  it('rejects signed PSBTs that do not match the original draft transaction', async () => {
    const fixture = buildFixture();
    const versionMismatch = mutateUnsignedPsbt(fixture, psbt => {
      psbt.setVersion(1);
    });
    const outputMismatch = buildFixture({ foreignOutput: true });
    const inputCountMismatch = buildFixture({ extraInput: true });
    const inputMismatch = buildFixture({ sequence: 0xfffffffd });
    const outputCountMismatch = buildFixture({ omitChangeOutput: true });
    setupRepositoryMocks(fixture);

    await expect(validSubmission(fixture, {
      psbtBase64: versionMismatch,
    })).rejects.toThrow('does not match');

    setupRepositoryMocks(fixture);

    await expect(validSubmission(fixture, {
      signedPsbtBase64: outputMismatch.signedPsbtBase64,
    })).rejects.toThrow('outputs do not match');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, {
      signedPsbtBase64: inputCountMismatch.signedPsbtBase64,
    })).rejects.toThrow('input count does not match');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, {
      signedPsbtBase64: inputMismatch.signedPsbtBase64,
    })).rejects.toThrow('inputs do not match');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, {
      signedPsbtBase64: outputCountMismatch.signedPsbtBase64,
    })).rejects.toThrow('output count does not match');
  });

  it('rejects empty, missing, frozen, and over-spending funding input sets', async () => {
    const fixture = buildFixture();
    const emptyPsbt = new bitcoin.Psbt({ network }).toBase64();

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, {
      psbtBase64: emptyPsbt,
      signedPsbtBase64: emptyPsbt,
    })).rejects.toThrow('at least one input');

    setupRepositoryMocks(fixture);
    mockFindByOutpointsForWallet.mockResolvedValueOnce([]);
    await expect(validSubmission(fixture)).rejects.toThrow('funding-wallet UTXOs');

    setupRepositoryMocks(fixture, { utxo: { frozen: true } });
    await expect(validSubmission(fixture)).rejects.toThrow('frozen');

    setupRepositoryMocks(fixture, { utxo: { amount: 90_000n } });
    await expect(validSubmission(fixture)).rejects.toThrow('outputs exceed');

  });

  it('allows refreshing an existing draft lock and reports RBF/input metadata from the PSBT', async () => {
    const fixture = buildFixture({ sequence: 0xfffffffd });
    setupRepositoryMocks(fixture, {
      utxo: {
        draftLock: { draftId: 'draft-1' },
      },
    });

    const result = await validSubmission(fixture, {
      allowedDraftLockId: 'draft-1',
    });

    expect(result.enableRBF).toBe(true);
    expect(result.selectedUtxoIds).toEqual([`${TXID}:0`]);
  });

  it('rejects linked wallet output edge cases', async () => {
    const fixture = buildFixture();

    setupRepositoryMocks(fixture);
    mockFindAddressStrings.mockImplementation(async (walletId: string) => {
      if (walletId === FUNDING_WALLET_ID) return [fixture.changeAddress, fixture.recipientAddress];
      if (walletId === OPERATIONAL_WALLET_ID) return [fixture.recipientAddress];
      return [];
    });
    await expect(validSubmission(fixture)).rejects.toThrow('must not share addresses');

    setupRepositoryMocks(fixture);
    await expect(validSubmission(fixture, {
      recipient: fixture.changeAddress,
    })).rejects.toThrow('recipient must belong');

    const zeroOperationalAmount = buildFixture({ recipientValue: 0n, changeValue: 95_000n });
    setupRepositoryMocks(zeroOperationalAmount);
    await expect(validSubmission(zeroOperationalAmount, {
      amount: 0,
    })).rejects.toThrow('positive amount');

    const missingRequestedRecipient = buildFixture();
    const unusedOperationalAddress = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 9),
      network,
    }).address!;
    setupRepositoryMocks(missingRequestedRecipient);
    mockFindAddressStrings.mockImplementation(async (walletId: string) => {
      if (walletId === FUNDING_WALLET_ID) return [missingRequestedRecipient.changeAddress];
      if (walletId === OPERATIONAL_WALLET_ID) return [missingRequestedRecipient.recipientAddress, unusedOperationalAddress];
      return [];
    });
    await expect(validSubmission(missingRequestedRecipient, {
      recipient: unusedOperationalAddress,
    })).rejects.toThrow('requested operational-wallet recipient');
  });

  it('rejects nonstandard, missing, or unsigned outputs and signer metadata gaps', async () => {
    const fixture = buildFixture();

    setupRepositoryMocks(fixture);
    mockFindDeviceById.mockResolvedValueOnce({ id: SIGNER_DEVICE_ID, fingerprint: 'deadbeef' });
    await expect(validSubmission(fixture)).rejects.toThrow('registered agent signer');

    const missingOutputs = buildFixture({ noOutputs: true });
    setupRepositoryMocks(missingOutputs);
    await expect(validSubmission(missingOutputs)).rejects.toThrow('at least one output');

    const nonstandardOutput = buildFixture({ nonstandardOutput: true });
    setupRepositoryMocks(nonstandardOutput);
    await expect(validSubmission(nonstandardOutput, {
      amount: 0,
    })).rejects.toThrow('standard wallet address');
  });
});

function validSubmission(
  fixture: Fixture,
  overrides: Partial<Parameters<typeof validateAgentFundingDraftSubmission>[0]> = {}
) {
  return validateAgentFundingDraftSubmission({
    fundingWalletId: FUNDING_WALLET_ID,
    operationalWalletId: OPERATIONAL_WALLET_ID,
    signerDeviceId: SIGNER_DEVICE_ID,
    recipient: fixture.recipientAddress,
    amount: 80000,
    psbtBase64: fixture.psbtBase64,
    signedPsbtBase64: fixture.signedPsbtBase64,
    ...overrides,
  });
}

function setupRepositoryMocks(
  fixture: Fixture,
  overrides: {
    utxo?: Partial<{
      spent: boolean;
      frozen: boolean;
      amount: bigint;
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
  addFundingInput(psbt, p2wsh, p2ms, agentPubkey, humanPubkey, options.sequence);
  if (options.extraInput) {
    addFundingInput(psbt, p2wsh, p2ms, agentPubkey, humanPubkey, options.sequence, TXID_ALT);
  }
  if (options.nonstandardOutput) {
    psbt.addOutput({ script: Buffer.from('6a', 'hex'), value: 0n });
  } else if (!options.noOutputs) {
    psbt.addOutput({ address: recipientAddress, value: options.recipientValue ?? 80000n });
  }
  if (!options.omitChangeOutput && !options.noOutputs && !options.nonstandardOutput) {
    psbt.addOutput({
      address: options.foreignOutput ? foreignAddress : changeAddress,
      value: options.changeValue ?? 15000n,
    });
  }

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

function mutateUnsignedPsbt(fixture: Fixture, mutate: (psbt: bitcoin.Psbt) => void): string {
  const psbt = bitcoin.Psbt.fromBase64(fixture.psbtBase64, { network });
  mutate(psbt);
  return psbt.toBase64();
}

function addFundingInput(
  psbt: bitcoin.Psbt,
  p2wsh: bitcoin.Payment,
  p2ms: bitcoin.Payment,
  agentPubkey: Buffer,
  humanPubkey: Buffer,
  sequence?: number,
  txid = TXID
): void {
  psbt.addInput({
    hash: txid,
    index: 0,
    sequence,
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

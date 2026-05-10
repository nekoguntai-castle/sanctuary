import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAddressStrings = vi.hoisted(() => vi.fn());
const mockGetPSBTInfoWithNetwork = vi.hoisted(() => vi.fn());

vi.mock('../../../src/repositories/addressRepository', () => ({
  addressRepository: {
    findAddressStrings: mockFindAddressStrings,
  },
}));

vi.mock('../../../src/services/bitcoin/transactionService', () => ({
  getPSBTInfoWithNetwork: mockGetPSBTInfoWithNetwork,
}));

import {
  assertBroadcastPayloadAvailable,
  assertExactOutpointsMatch,
  assertMetadataFieldMatches,
  buildSignedPsbtBroadcastIntent,
  getDraftBroadcastUtxos,
  parseDraftUtxoReference,
  resolveSignedPsbtForBroadcast,
  type BroadcastDraft,
  type BroadcastOutpoint,
  type TransactionBroadcastBody,
} from '../../../src/api/transactions/broadcastIntent';

const txidA = 'a'.repeat(64);
const txidB = 'b'.repeat(64);
const txidC = 'c'.repeat(64);

const outpoint = (txid: string, vout: number): BroadcastOutpoint => ({ txid, vout });

const makeDraft = (overrides: Partial<BroadcastDraft> = {}): BroadcastDraft => ({
  id: 'draft-1',
  walletId: 'wallet-1',
  userId: 'user-1',
  recipient: 'tb1qdraftrecipient',
  amount: BigInt(1000),
  effectiveAmount: null,
  fee: BigInt(100),
  feeRate: null,
  status: 'signed',
  approvalStatus: 'approved',
  createdBy: 'user-1',
  signedPsbtBase64: 'draft-psbt',
  unsignedPsbtBase64: 'unsigned-draft-psbt',
  selectedUtxoIds: [`${txidA}:0`],
  decoyOutputData: null,
  changeAddress: null,
  changeAmount: null,
  inputPaths: null,
  payjoinUrl: null,
  label: null,
  memo: null,
  policyEvaluation: null,
  approvalId: null,
  signedAt: null,
  broadcastAt: null,
  expiresAt: null,
  createdAt: new Date('2026-05-09T00:00:00.000Z'),
  updatedAt: new Date('2026-05-09T00:00:00.000Z'),
  ...overrides,
});

describe('broadcast intent helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAddressStrings.mockResolvedValue([]);
    mockGetPSBTInfoWithNetwork.mockReturnValue({
      fee: 100,
      outputs: [{ address: 'tb1qrecipient', value: 1000 }],
      inputs: [outpoint(txidA, 0)],
    });
  });

  it('accepts only exact draft UTXO references', () => {
    expect(parseDraftUtxoReference(`${txidA}:1`)).toEqual(outpoint(txidA, 1));
    expect(parseDraftUtxoReference(`${txidA}:4294967295`)).toEqual(outpoint(txidA, 4294967295));
    expect(parseDraftUtxoReference(`0${txidA}:1`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}0:1`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}: 0`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:+1`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:-1`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:1.5`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:1suffix`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:4294967296`)).toBeNull();
    expect(parseDraftUtxoReference(`${txidA}:9007199254740993`)).toBeNull();
    expect(parseDraftUtxoReference('not-an-outpoint')).toBeNull();
  });

  it('handles missing drafts and resolves request PSBTs before draft PSBTs', () => {
    expect(getDraftBroadcastUtxos(null)).toEqual([]);
    expect(resolveSignedPsbtForBroadcast({} as TransactionBroadcastBody, null)).toBeUndefined();
    expect(resolveSignedPsbtForBroadcast(
      { signedPsbtBase64: 'request-psbt' } as TransactionBroadcastBody,
      makeDraft()
    )).toBe('request-psbt');
    expect(resolveSignedPsbtForBroadcast({} as TransactionBroadcastBody, makeDraft())).toBe('draft-psbt');
    expect(resolveSignedPsbtForBroadcast(
      { rawTxHex: '00' } as TransactionBroadcastBody,
      makeDraft()
    )).toBeUndefined();
  });

  it('rejects missing broadcast payloads with a typed error', () => {
    expect(() => assertBroadcastPayloadAvailable({} as TransactionBroadcastBody, undefined, null))
      .toThrow('Draft does not have a signed PSBT to broadcast');
  });

  it('compares outpoint sets without trusting caller order', () => {
    expect(() => assertExactOutpointsMatch(
      [outpoint(txidA, 0), outpoint(txidB, 1)],
      [outpoint(txidB, 1), outpoint(txidA, 0)],
      'utxos'
    )).not.toThrow();
    expect(() => assertExactOutpointsMatch(
      [outpoint(txidB, 1), outpoint(txidA, 0)],
      [outpoint(txidA, 0), outpoint(txidB, 1)],
      'utxos'
    )).not.toThrow();

    expect(() => assertExactOutpointsMatch(
      [outpoint(txidA, 0), outpoint(txidB, 1)],
      [outpoint(txidA, 0), outpoint(txidC, 2)],
      'utxos'
    )).toThrow('Transaction metadata does not match decoded transaction');
    expect(() => assertExactOutpointsMatch(
      [outpoint(txidA, 0), outpoint(txidB, 1)],
      [outpoint(txidA, 0), outpoint(txidB, 1), outpoint(txidC, 2)],
      'utxos'
    )).toThrow('Transaction metadata does not match decoded transaction');
  });

  it('rejects scalar metadata conflicts', () => {
    expect(() => assertMetadataFieldMatches('amount', 1000, 1000)).not.toThrow();
    expect(() => assertMetadataFieldMatches('amount', 1000, 999))
      .toThrow('Transaction metadata does not match decoded transaction');
  });

  it('allows zero-fee PSBTs and ignores zero-value non-address outputs', async () => {
    mockFindAddressStrings.mockResolvedValue(['tb1qchange']);
    mockGetPSBTInfoWithNetwork.mockReturnValue({
      fee: 0,
      outputs: [
        { value: 0 },
        { address: 'tb1qchange', value: 5000 },
      ],
      inputs: [outpoint(txidA, 0)],
    });

    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'psbt', 'testnet3', 'signedPsbtBase64'))
      .resolves.toEqual({
        recipient: 'tb1qchange',
        amount: 0,
        fee: 0,
        utxos: [outpoint(txidA, 0)],
      });
  });

  it('ignores zero-value address outputs when selecting the external recipient', async () => {
    mockGetPSBTInfoWithNetwork.mockReturnValue({
      fee: 50,
      outputs: [
        { address: 'tb1qzero', value: 0 },
        { address: 'tb1qrecipient', value: 2000 },
      ],
      inputs: [outpoint(txidA, 0)],
    });

    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'psbt', 'testnet3', 'signedPsbtBase64'))
      .resolves.toMatchObject({
        recipient: 'tb1qrecipient',
        amount: 2000,
        fee: 50,
      });
  });

  it('does not treat malformed addressed outputs as recipients', async () => {
    mockGetPSBTInfoWithNetwork.mockReturnValue({
      fee: 50,
      outputs: [
        { address: 123, value: 1000 },
        { address: 'tb1qrecipient', value: 2000 },
      ],
      inputs: [outpoint(txidA, 0)],
    });

    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'psbt', 'testnet3', 'signedPsbtBase64'))
      .resolves.toMatchObject({
        recipient: 'tb1qrecipient',
        amount: 2000,
        fee: 50,
      });
  });

  it('rejects invalid, incomplete, and unsupported signed PSBTs', async () => {
    mockGetPSBTInfoWithNetwork.mockImplementationOnce(() => {
      throw new Error('bad psbt');
    });
    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'bad', 'testnet3', 'signedPsbtBase64'))
      .rejects.toMatchObject({
        message: 'Invalid signed PSBT',
        details: expect.objectContaining({ reason: 'invalid_psbt', message: 'bad psbt' }),
      });

    mockGetPSBTInfoWithNetwork.mockReturnValueOnce({
      fee: -1,
      outputs: [{ address: 'tb1qrecipient', value: 1000 }],
      inputs: [outpoint(txidA, 0)],
    });
    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'unknown-fee', 'testnet3', 'signedPsbtBase64'))
      .rejects.toMatchObject({
        message: 'Signed PSBT input values are incomplete',
        details: expect.objectContaining({ reason: 'unknown_input_value' }),
      });

    mockGetPSBTInfoWithNetwork.mockReturnValueOnce({
      fee: 10,
      outputs: [{ value: 1000 }],
      inputs: [outpoint(txidA, 0)],
    });
    await expect(buildSignedPsbtBroadcastIntent('wallet-1', 'unsupported-output', 'testnet3', 'signedPsbtBase64'))
      .rejects.toMatchObject({
        message: 'Signed PSBT has paid output without a standard address',
        details: expect.objectContaining({ reason: 'unsupported_script' }),
      });
  });
});

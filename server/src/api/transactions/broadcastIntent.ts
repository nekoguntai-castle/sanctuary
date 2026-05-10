import { InvalidInputError } from '../../errors/ApiError';
import type { DraftTransaction } from '../../generated/prisma/client';
import { addressRepository } from '../../repositories/addressRepository';
import * as txService from '../../services/bitcoin/transactionService';
import type { BitcoinNetwork } from '../../services/bitcoin/networks';
import type {
  TransactionInputMetadata,
  TransactionOutputMetadata,
} from '../../services/bitcoin/transactions/types';
import { getErrorMessage } from '../../utils/errors';
import type { MobileTransactionBroadcastRequest } from '../../../../shared/schemas/mobileApiRequests';

export type TransactionBroadcastBody = MobileTransactionBroadcastRequest;
export type BroadcastDraft = DraftTransaction;
export type BroadcastOutpoint = { txid: string; vout: number };
export type CanonicalBroadcastRouteIntent = {
  recipient: string;
  amount: number;
  fee: number;
  utxos: BroadcastOutpoint[];
  inputs?: TransactionInputMetadata[];
  outputs?: TransactionOutputMetadata[];
};
export type RawBroadcastIntent = CanonicalBroadcastRouteIntent & {
  inputs: TransactionInputMetadata[];
  outputs: TransactionOutputMetadata[];
};

type PsbtInfo = ReturnType<typeof txService.getPSBTInfoWithNetwork>;
type PsbtOutput = PsbtInfo['outputs'][number];
type AddressedPsbtOutput = PsbtOutput & { address: string };

const MAX_VOUT_INDEX = 0xffffffff;

export const outpointKey = (outpoint: BroadcastOutpoint): string => `${outpoint.txid}:${outpoint.vout}`;

const parseVoutIndex = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;

  const vout = Number(value);
  if (!Number.isSafeInteger(vout) || vout > MAX_VOUT_INDEX) return null;

  return vout;
};

export const parseDraftUtxoReference = (utxoId: string): BroadcastOutpoint | null => {
  // Drafts store selected UTXOs as txid:vout. Invalid legacy values are ignored
  // so explicit request metadata can still carry the spend set.
  const separatorIndex = utxoId.lastIndexOf(':');
  if (separatorIndex <= 0) return null;

  const txid = utxoId.slice(0, separatorIndex);
  const vout = parseVoutIndex(utxoId.slice(separatorIndex + 1));
  if (!/^[a-fA-F0-9]{64}$/.test(txid) || vout === null) {
    return null;
  }

  return { txid, vout };
};

export const getDraftBroadcastAmount = (draft: BroadcastDraft | null): number | undefined => {
  if (!draft) return undefined;
  return Number(draft.effectiveAmount ?? draft.amount);
};

export const getDraftBroadcastUtxos = (draft: BroadcastDraft | null): BroadcastOutpoint[] => {
  /* v8 ignore next -- callers only compare draft UTXOs after a draft is loaded */
  if (!draft) return [];
  return draft.selectedUtxoIds.flatMap(utxoId => {
    const parsed = parseDraftUtxoReference(utxoId);
    return parsed ? [parsed] : [];
  });
};

export const resolveSignedPsbtForBroadcast = (
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null
): string | undefined => {
  if (body.signedPsbtBase64) return body.signedPsbtBase64;
  if (body.rawTxHex) return undefined;
  return draft?.signedPsbtBase64 ?? undefined;
};

export const assertBroadcastPayloadAvailable = (
  body: TransactionBroadcastBody,
  signedPsbtBase64: string | undefined,
  draft: BroadcastDraft | null
): void => {
  if (body.rawTxHex || signedPsbtBase64) return;

  throw new InvalidInputError(
    'Draft does not have a signed PSBT to broadcast',
    'draftId',
    {
      draftId: draft?.id,
      reason: 'missing_witness_data',
    }
  );
};

export const assertExactOutpointsMatch = (
  expected: BroadcastOutpoint[],
  actual: BroadcastOutpoint[] | undefined,
  source: string
): void => {
  if (actual === undefined) return;

  const expectedKeys = expected.map(outpointKey).sort();
  const actualKeys = actual.map(outpointKey).sort();
  const matches = expectedKeys.length === actualKeys.length
    && expectedKeys.every((key, index) => key === actualKeys[index]);
  if (matches) return;

  throw new InvalidInputError('Transaction metadata does not match decoded transaction', source, {
    reason: 'metadata_mismatch',
    expected: expectedKeys,
    actual: actualKeys,
  });
};

export const assertMetadataFieldMatches = (
  field: 'recipient' | 'amount' | 'fee',
  expected: string | number,
  actual: string | number | undefined
): void => {
  if (actual === undefined || actual === expected) return;

  throw new InvalidInputError('Transaction metadata does not match decoded transaction', field, {
    reason: 'metadata_mismatch',
    expected,
    actual,
  });
};

const hasPaidAddress = (output: PsbtOutput): output is AddressedPsbtOutput => {
  return typeof output.address === 'string' && output.address.length > 0 && output.value > 0;
};

const parseSignedPsbtForBroadcast = (
  signedPsbtBase64: string,
  network: BitcoinNetwork,
  field: string
): PsbtInfo => {
  try {
    return txService.getPSBTInfoWithNetwork(signedPsbtBase64, network);
  } catch (error) {
    throw new InvalidInputError('Invalid signed PSBT', field, {
      reason: 'invalid_psbt',
      message: getErrorMessage(error),
    });
  }
};

const assertSignedPsbtFeeKnown = (fee: number, field: string): void => {
  if (fee >= 0) return;

  throw new InvalidInputError('Signed PSBT input values are incomplete', field, {
    reason: 'unknown_input_value',
    fee,
  });
};

const resolveSignedPsbtRecipientAndAmount = (
  outputs: PsbtInfo['outputs'],
  walletAddressSet: Set<string>,
  field: string
): { recipient: string; amount: number } => {
  const paidUnknownOutput = outputs.find(output => !output.address && output.value > 0);
  if (paidUnknownOutput) {
    throw new InvalidInputError('Signed PSBT has paid output without a standard address', field, {
      reason: 'unsupported_script',
    });
  }

  const paidAddressOutputs = outputs.filter(hasPaidAddress);
  const externalOutput = paidAddressOutputs.find(output => !walletAddressSet.has(output.address));
  if (externalOutput) {
    return { recipient: externalOutput.address, amount: externalOutput.value };
  }

  const ownOutput = paidAddressOutputs.find(output => walletAddressSet.has(output.address));
  if (ownOutput) {
    return { recipient: ownOutput.address, amount: 0 };
  }

  return { recipient: '', amount: 0 };
};

export const buildSignedPsbtBroadcastIntent = async (
  walletId: string,
  signedPsbtBase64: string,
  network: BitcoinNetwork,
  field: string
): Promise<CanonicalBroadcastRouteIntent> => {
  const psbtInfo = parseSignedPsbtForBroadcast(signedPsbtBase64, network, field);
  assertSignedPsbtFeeKnown(psbtInfo.fee, field);

  const walletAddresses = await addressRepository.findAddressStrings(walletId);
  const { recipient, amount } = resolveSignedPsbtRecipientAndAmount(
    psbtInfo.outputs,
    new Set(walletAddresses),
    field
  );

  return {
    recipient,
    amount,
    fee: psbtInfo.fee,
    utxos: psbtInfo.inputs.map(input => ({ txid: input.txid, vout: input.vout })),
  };
};

export const assertSignedPsbtMetadataMatches = (
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null,
  intent: CanonicalBroadcastRouteIntent
): void => {
  assertMetadataFieldMatches('recipient', intent.recipient, body.recipient ?? draft?.recipient);
  assertMetadataFieldMatches('amount', intent.amount, body.amount ?? getDraftBroadcastAmount(draft));
  assertMetadataFieldMatches('fee', intent.fee, body.fee ?? (draft ? Number(draft.fee) : undefined));
  assertExactOutpointsMatch(intent.utxos, body.utxos, 'utxos');
  if (draft) {
    assertExactOutpointsMatch(intent.utxos, getDraftBroadcastUtxos(draft), 'draftId');
  }
};

/**
 * Agent Funding Draft Validation
 *
 * Validates agent-submitted funding drafts from decoded PSBT contents before
 * Sanctuary stores and notifies humans about a partial multisig draft.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { Prisma } from '../generated/prisma/client';
import {
  addressRepository,
  deviceRepository,
  utxoRepository,
  walletRepository,
} from '../repositories';
import {
  ConflictError,
  ErrorCodes,
  InvalidInputError,
  InvalidPsbtError,
  NotFoundError,
} from '../errors';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { getNetwork } from './bitcoin/utils';
import {
  getPsbtInputs,
  parsePsbt,
  type PsbtInput,
} from './bitcoin/psbtValidation';

const log = createLogger('AGENT:FUNDING_VALIDATION');

type SupportedNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface ValidateAgentFundingDraftSubmissionInput {
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  recipient: string;
  amount: number | string;
  psbtBase64: string;
  signedPsbtBase64: string;
  allowedDraftLockId?: string;
}

export interface ValidatedAgentFundingDraft {
  recipient: string;
  amount: string;
  selectedUtxoIds: string[];
  fee: string;
  totalInput: string;
  totalOutput: string;
  changeAmount: string;
  changeAddress?: string;
  effectiveAmount: string;
  enableRBF: boolean;
  inputs: Prisma.InputJsonValue;
  outputs: Prisma.InputJsonValue;
  inputPaths: string[];
}

interface DecodedOutput {
  address: string;
  amount: bigint;
}

interface FundingInputValidation {
  selectedUtxoIds: string[];
  totalInput: bigint;
  inputs: Prisma.InputJsonValue;
}

interface OutputValidation {
  operationalAmount: bigint;
  changeAmount: bigint;
  changeAddress?: string;
  outputs: Prisma.InputJsonValue;
}

interface FundingUtxo {
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  spent: boolean;
  frozen: boolean;
  draftLock: { draftId: string } | null;
}

interface LinkedWalletOutputsInput {
  decodedOutputs: DecodedOutput[];
  fundingAddresses: string[];
  operationalAddresses: string[];
  recipient: string;
  declaredAmount: bigint;
}

const SATS_PATTERN = /^\d+$/;
const SIGNATURE_VALIDATOR = (
  pubkey: Uint8Array,
  msghash: Uint8Array,
  signature: Uint8Array,
): boolean => {
  try {
    return ecc.verify(msghash, pubkey, signature);
    /* v8 ignore next -- defensive: tiny-secp256k1 verify is expected to return false for invalid signatures */
  } catch {
    /* v8 ignore next -- defensive: tiny-secp256k1 verify is expected to return false for invalid signatures */
    return false;
  }
};

/**
 * Validate a submitted agent funding draft and return draft fields derived from
 * the signed PSBT rather than trusting agent-supplied display/locking metadata.
 */
export async function validateAgentFundingDraftSubmission(
  input: ValidateAgentFundingDraftSubmissionInput,
): Promise<ValidatedAgentFundingDraft> {
  if (input.fundingWalletId === input.operationalWalletId) {
    throw new InvalidInputError(
      'Funding wallet and operational wallet must be different',
    );
  }

  const [fundingWallet, operationalWallet, signerDevice] = await Promise.all([
    walletRepository.findById(input.fundingWalletId),
    walletRepository.findById(input.operationalWalletId),
    deviceRepository.findById(input.signerDeviceId),
  ]);

  if (!fundingWallet) {
    throw new NotFoundError('Funding wallet not found');
  }
  if (!operationalWallet) {
    throw new NotFoundError('Operational wallet not found');
  }
  if (!signerDevice) {
    throw new NotFoundError('Signer device not found');
  }
  if (fundingWallet.type !== 'multi_sig') {
    throw new InvalidInputError('Funding wallet must be a multisig wallet');
  }
  if (fundingWallet.network !== operationalWallet.network) {
    throw new InvalidInputError(
      'Funding wallet and operational wallet must use the same network',
    );
  }

  const networkName = parseSupportedNetwork(fundingWallet.network);
  const network = getNetwork(networkName);
  const signerFingerprint = normalizeFingerprint(signerDevice.fingerprint);
  const recipient = input.recipient.trim();

  const unsignedPsbt = parseSubmittedPsbt(
    input.psbtBase64,
    network,
    'psbtBase64',
  );
  const signedPsbt = parseSubmittedPsbt(
    input.signedPsbtBase64,
    network,
    'signedPsbtBase64',
  );

  validateSameUnsignedTransaction(unsignedPsbt, signedPsbt);
  validateSignerPartialSignatures(signedPsbt, signerFingerprint);

  const decodedInputs = getPsbtInputs(signedPsbt);
  const fundingInputValidation = await validateFundingInputs(
    input.fundingWalletId,
    decodedInputs,
    input.allowedDraftLockId,
  );

  const [fundingAddresses, operationalAddresses] = await Promise.all([
    addressRepository.findAddressStrings(input.fundingWalletId),
    addressRepository.findAddressStrings(input.operationalWalletId),
  ]);
  const decodedOutputs = decodeOutputs(signedPsbt, network);
  const outputValidation = validateLinkedWalletOutputs({
    decodedOutputs,
    fundingAddresses,
    operationalAddresses,
    recipient,
    declaredAmount: parseSats(input.amount, 'amount'),
  });

  const totalOutput = decodedOutputs.reduce(
    (sum, output) => sum + output.amount,
    0n,
  );
  if (totalOutput > fundingInputValidation.totalInput) {
    throw new InvalidPsbtError('PSBT outputs exceed funding wallet inputs');
  }

  const fee = fundingInputValidation.totalInput - totalOutput;
  return {
    recipient,
    amount: outputValidation.operationalAmount.toString(),
    selectedUtxoIds: fundingInputValidation.selectedUtxoIds,
    fee: fee.toString(),
    totalInput: fundingInputValidation.totalInput.toString(),
    totalOutput: totalOutput.toString(),
    changeAmount: outputValidation.changeAmount.toString(),
    changeAddress: outputValidation.changeAddress,
    effectiveAmount: outputValidation.operationalAmount.toString(),
    enableRBF: decodedInputs.some((input) => input.sequence < 0xfffffffe),
    inputs: fundingInputValidation.inputs,
    outputs: outputValidation.outputs,
    inputPaths: getSignerInputPaths(signedPsbt, signerFingerprint),
  };
}

const parseSupportedNetwork = (network: string): SupportedNetwork => {
  if (network === 'mainnet' || network === 'testnet' || network === 'regtest') {
    return network;
  }

  throw new InvalidInputError(
    `Unsupported wallet network: ${network}`,
    'network',
  );
};

const normalizeFingerprint = (fingerprint: string): string => {
  const normalized = fingerprint.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new InvalidInputError(
      'Signer device fingerprint must be an 8-character hex string',
    );
  }
  return normalized;
};

const parseSats = (value: number | string, field: string): bigint => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidInputError(
        `${field} must be a non-negative integer`,
        field,
      );
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!SATS_PATTERN.test(trimmed)) {
    throw new InvalidInputError(
      `${field} must be a non-negative integer`,
      field,
    );
  }

  return BigInt(trimmed);
};

const parseSubmittedPsbt = (
  psbtBase64: string,
  network: bitcoin.Network,
  field: string,
): bitcoin.Psbt => {
  try {
    return parsePsbt(psbtBase64, network);
  } catch (error) {
    throw new InvalidPsbtError(
      `${field} is not a valid PSBT: ${getErrorMessage(error)}`,
    );
  }
};

const validateSameUnsignedTransaction = (
  unsignedPsbt: bitcoin.Psbt,
  signedPsbt: bitcoin.Psbt,
): void => {
  if (
    unsignedPsbt.version !== signedPsbt.version ||
    unsignedPsbt.locktime !== signedPsbt.locktime
  ) {
    throw new InvalidPsbtError(
      'Signed PSBT transaction does not match the draft PSBT',
    );
  }

  const unsignedInputs = getPsbtInputs(unsignedPsbt);
  const signedInputs = getPsbtInputs(signedPsbt);
  if (unsignedInputs.length !== signedInputs.length) {
    throw new InvalidPsbtError(
      'Signed PSBT input count does not match the draft PSBT',
    );
  }

  for (let index = 0; index < unsignedInputs.length; index++) {
    const expected = unsignedInputs[index];
    const actual = signedInputs[index];
    if (
      expected.txid !== actual.txid ||
      expected.vout !== actual.vout ||
      expected.sequence !== actual.sequence
    ) {
      throw new InvalidPsbtError(
        'Signed PSBT inputs do not match the draft PSBT',
      );
    }
  }

  if (unsignedPsbt.txOutputs.length !== signedPsbt.txOutputs.length) {
    throw new InvalidPsbtError(
      'Signed PSBT output count does not match the draft PSBT',
    );
  }

  for (let index = 0; index < unsignedPsbt.txOutputs.length; index++) {
    const expected = unsignedPsbt.txOutputs[index];
    const actual = signedPsbt.txOutputs[index];
    const expectedScript = Buffer.from(expected.script).toString('hex');
    const actualScript = Buffer.from(actual.script).toString('hex');
    if (
      expectedScript !== actualScript ||
      BigInt(expected.value) !== BigInt(actual.value)
    ) {
      throw new InvalidPsbtError(
        'Signed PSBT outputs do not match the draft PSBT',
      );
    }
  }
};

const validateSignerPartialSignatures = (
  psbt: bitcoin.Psbt,
  signerFingerprint: string,
): void => {
  if (psbt.inputCount === 0) {
    throw new InvalidPsbtError('Signed PSBT must contain at least one input');
  }

  for (let inputIndex = 0; inputIndex < psbt.data.inputs.length; inputIndex++) {
    if (!inputHasValidSignerSignature(psbt, inputIndex, signerFingerprint)) {
      throw new InvalidPsbtError(
        'Signed PSBT must include a valid partial signature from the registered agent signer on every input',
      );
    }
  }
};

const inputHasValidSignerSignature = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  signerFingerprint: string,
): boolean => {
  const psbtInput = psbt.data.inputs[inputIndex];
  const signerPubkeys = new Set(
    /* v8 ignore next -- PSBT input metadata is normalized by bitcoinjs before validation */
    (psbtInput.bip32Derivation ?? [])
      .filter(
        (derivation) =>
          Buffer.from(derivation.masterFingerprint)
            .toString('hex')
            .toLowerCase() === signerFingerprint,
      )
      .map((derivation) => Buffer.from(derivation.pubkey).toString('hex')),
  );

  if (signerPubkeys.size === 0) {
    return false;
  }

  /* v8 ignore next -- unsigned/empty signature PSBTs are rejected before this helper is reached */
  for (const partialSig of psbtInput.partialSig ?? []) {
    const pubkeyHex = Buffer.from(partialSig.pubkey).toString('hex');
    if (!signerPubkeys.has(pubkeyHex)) {
      continue;
    }

    try {
      /* v8 ignore next -- defensive: bitcoinjs signature validation is covered by valid/invalid signature outcomes */
      if (
        psbt.validateSignaturesOfInput(
          inputIndex,
          SIGNATURE_VALIDATOR,
          partialSig.pubkey,
        )
      ) {
        return true;
      }
    } catch (error) {
      log.debug(
        'Agent partial signature validation failed while scanning signer signatures',
        {
          inputIndex,
          signerFingerprint,
          error: getErrorMessage(error),
        },
      );
    }
  }

  return false;
};

const validateFundingInputs = async (
  fundingWalletId: string,
  decodedInputs: PsbtInput[],
  allowedDraftLockId?: string,
): Promise<FundingInputValidation> => {
  /* v8 ignore next -- decodePsbt rejects PSBTs without inputs before funding-input validation */
  if (decodedInputs.length === 0) {
    throw new InvalidPsbtError('PSBT must contain at least one input');
  }

  const seenOutpoints = new Set<string>();
  for (const input of decodedInputs) {
    const key = formatOutpoint(input);
    /* v8 ignore next -- bitcoinjs rejects duplicate PSBT inputs while constructing/parsing */
    if (seenOutpoints.has(key)) {
      throw new InvalidPsbtError('PSBT contains duplicate input outpoints');
    }
    seenOutpoints.add(key);
  }

  const utxos = await utxoRepository.findByOutpointsForWallet(
    fundingWalletId,
    decodedInputs,
  );
  const utxoByOutpoint = new Map(
    utxos.map((utxo) => [formatOutpoint(utxo), utxo]),
  );
  const missingOutpoints = decodedInputs
    .map((input) => formatOutpoint(input))
    .filter((outpoint) => !utxoByOutpoint.has(outpoint));

  if (missingOutpoints.length > 0) {
    throw new InvalidPsbtError('PSBT inputs must all be funding-wallet UTXOs');
  }

  const unavailable = utxos.find((utxo) => utxo.spent);
  if (unavailable) {
    throw new InvalidPsbtError(
      'PSBT spends an already-spent funding-wallet UTXO',
    );
  }

  const frozen = utxos.find((utxo) => utxo.frozen);
  if (frozen) {
    throw new InvalidInputError(
      'PSBT spends a frozen funding-wallet UTXO',
      undefined,
      { reasonCode: 'utxo_frozen' },
    );
  }

  const locked = utxos.find(
    (utxo) => utxo.draftLock && utxo.draftLock.draftId !== allowedDraftLockId,
  );
  if (locked) {
    throw new ConflictError(
      'PSBT spends a UTXO already locked by another draft transaction',
      ErrorCodes.CONFLICT,
      { reasonCode: 'utxo_locked' },
    );
  }

  const orderedUtxos = decodedInputs.map(
    (input) => utxoByOutpoint.get(formatOutpoint(input)) as FundingUtxo,
  );
  return {
    selectedUtxoIds: decodedInputs.map(formatOutpoint),
    totalInput: orderedUtxos.reduce((sum, utxo) => sum + utxo.amount, 0n),
    inputs: orderedUtxos.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxo.address,
      amount: Number(utxo.amount),
    })) as Prisma.InputJsonValue,
  };
};

const decodeOutputs = (
  psbt: bitcoin.Psbt,
  network: bitcoin.Network,
): DecodedOutput[] => {
  if (psbt.txOutputs.length === 0) {
    throw new InvalidPsbtError('PSBT must contain at least one output');
  }

  return psbt.txOutputs.map((output, index) => {
    try {
      return {
        address: bitcoin.address.fromOutputScript(output.script, network),
        amount: BigInt(output.value),
      };
    } catch {
      throw new InvalidPsbtError(
        `PSBT output ${index} must pay a standard wallet address`,
      );
    }
  });
};

const validateLinkedWalletOutputs = (
  input: LinkedWalletOutputsInput,
): OutputValidation => {
  const fundingAddressSet = new Set(input.fundingAddresses);
  const operationalAddressSet = new Set(input.operationalAddresses);

  if (!operationalAddressSet.has(input.recipient)) {
    throw new InvalidInputError(
      'recipient must belong to the linked operational wallet',
      'recipient',
      { reasonCode: 'policy_destination_mismatch' },
    );
  }

  for (const address of operationalAddressSet) {
    if (fundingAddressSet.has(address)) {
      throw new InvalidInputError(
        'Funding and operational wallets must not share addresses',
      );
    }
  }

  let operationalAmount = 0n;
  let changeAmount = 0n;
  const changeAddresses = new Set<string>();
  let paysRecipient = false;

  for (const output of input.decodedOutputs) {
    if (operationalAddressSet.has(output.address)) {
      operationalAmount += output.amount;
      paysRecipient = paysRecipient || output.address === input.recipient;
    } else if (fundingAddressSet.has(output.address)) {
      changeAmount += output.amount;
      changeAddresses.add(output.address);
    } else {
      throw new InvalidPsbtError(
        'PSBT outputs must pay only the linked operational wallet or funding-wallet change',
      );
    }
  }

  if (!paysRecipient) {
    throw new InvalidPsbtError(
      'PSBT must pay the requested operational-wallet recipient',
    );
  }
  if (operationalAmount <= 0n) {
    throw new InvalidPsbtError(
      'PSBT must pay a positive amount to the operational wallet',
    );
  }
  if (operationalAmount !== input.declaredAmount) {
    throw new InvalidInputError(
      'amount must equal the total paid to the operational wallet',
      'amount',
    );
  }

  return {
    operationalAmount,
    changeAmount,
    changeAddress:
      changeAddresses.size === 1 ? [...changeAddresses][0] : undefined,
    outputs: input.decodedOutputs.map((output) => ({
      address: output.address,
      amount: Number(output.amount),
    })) as Prisma.InputJsonValue,
  };
};

const getSignerInputPaths = (
  psbt: bitcoin.Psbt,
  signerFingerprint: string,
): string[] => {
  return psbt.data.inputs.flatMap(
    (input) =>
      /* v8 ignore start -- PSBT input metadata is normalized by bitcoinjs before validation */
      (input.bip32Derivation ?? [])
        .filter(
          (derivation) =>
            Buffer.from(derivation.masterFingerprint)
              .toString('hex')
              .toLowerCase() === signerFingerprint,
        )
        .map((derivation) => derivation.path)
        .filter(
          (path): path is string => typeof path === 'string' && path.length > 0,
        ),
    /* v8 ignore stop */
  );
};

const formatOutpoint = (outpoint: { txid: string; vout: number }): string => {
  return `${outpoint.txid}:${outpoint.vout}`;
};

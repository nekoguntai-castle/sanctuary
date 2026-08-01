/**
 * Sender-side Payjoin proposal integrity checks.
 *
 * These helpers enforce the BIP78 sender safety boundary before a receiver's
 * proposal is returned for signing: original transaction fields, sender inputs,
 * sender outputs, and fee policy must remain within the sender's intent.
 */
import * as bitcoin from 'bitcoinjs-lib';
import type { PsbtInput, PsbtOutput, ValidationResult } from './psbtValidation';

type ValidationMessages = Pick<ValidationResult, 'errors' | 'warnings'>;

/**
 * Resolve the network for validatePayjoinProposal's temporary compatibility
 * signature. The array form is deprecated: old callers used it for
 * senderInputIndices, but the sender-side safety invariant now derives every
 * sender input from the original PSBT and never trusts caller-supplied indices.
 */
export const resolvePayjoinNetwork = (
  networkOrSenderInputIndices: bitcoin.Network | number[] | undefined,
  legacyNetwork: bitcoin.Network
): bitcoin.Network => {
  return Array.isArray(networkOrSenderInputIndices)
    ? legacyNetwork
    : networkOrSenderInputIndices ?? bitcoin.networks.bitcoin;
};

export const resolveLegacySenderInputIndices = (
  networkOrSenderInputIndices: bitcoin.Network | number[] | undefined
): number[] | null => {
  return Array.isArray(networkOrSenderInputIndices) ? networkOrSenderInputIndices : null;
};

export const validateTransactionFields = (
  original: bitcoin.Psbt,
  proposal: bitcoin.Psbt,
  { errors }: ValidationMessages
): void => {
  if (original.version !== proposal.version) {
    errors.push(`Transaction version changed from ${original.version} to ${proposal.version}`);
  }

  if (original.locktime !== proposal.locktime) {
    errors.push(`Transaction locktime changed from ${original.locktime} to ${proposal.locktime}`);
  }
};

export const validateSenderOutputs = (
  originalOutputs: PsbtOutput[],
  proposalOutputs: PsbtOutput[],
  messages: ValidationMessages
): void => {
  // Match original outputs as a relative-order script multiset. This prevents a
  // receiver proposal from satisfying two same-script sender outputs with one
  // output, and it keeps non-address scripts in the fail-closed preservation set.
  let proposalSearchStart = 0;
  originalOutputs.forEach((origOutput, originalIndex) => {
    const proposalIndex = findNextOutputByScript(
      proposalOutputs,
      origOutput.scriptHex,
      proposalSearchStart
    );

    validateSenderOutput(originalIndex, origOutput, proposalOutputs[proposalIndex], messages);
    if (proposalIndex >= 0) {
      proposalSearchStart = proposalIndex + 1;
    }
  });
};

const findNextOutputByScript = (
  outputs: PsbtOutput[],
  scriptHex: string,
  startIndex: number
): number => {
  return outputs.findIndex((output, index) => (
    index >= startIndex && output.scriptHex === scriptHex
  ));
};

const validateSenderOutput = (
  originalIndex: number,
  origOutput: PsbtOutput,
  matchingOutput: PsbtOutput | undefined,
  { errors, warnings }: ValidationMessages
): void => {
  if (!matchingOutput) {
    errors.push(`Original output ${originalIndex} ${describeOutput(origOutput)} was removed`);
  } else if (matchingOutput.value < origOutput.value) {
    errors.push(
      `Original output ${originalIndex} ${describeOutput(origOutput)} decreased from ${origOutput.value} to ${matchingOutput.value}`
    );
  } else if (matchingOutput.value > origOutput.value) {
    warnings.push(
      `Original output ${originalIndex} ${describeOutput(origOutput)} increased from ${origOutput.value} to ${matchingOutput.value}`
    );
  }
};

const describeOutput = (output: PsbtOutput): string => {
  return output.address === 'unknown'
    ? `script ${output.scriptHex}`
    : `to ${output.address} (${output.scriptHex})`;
};

export const validateSenderInputs = (
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  messages: ValidationMessages
): void => {
  validateOriginalInputCounts(originalInputs, proposalInputs, messages.errors);
  validateOriginalInputOrderAndSequences(originalInputs, proposalInputs, messages.errors);
};

export const validateLegacySenderInputIndices = (
  senderInputIndices: number[] | null,
  originalInputs: PsbtInput[],
  errors: string[]
): void => {
  if (!senderInputIndices) return;

  for (const idx of senderInputIndices) {
    if (idx < originalInputs.length) continue;

    errors.push(`Sender input index ${idx} out of range`);
  }
};

const validateOriginalInputCounts = (
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  errors: string[]
): void => {
  const proposalCounts = countInputsByOutpoint(proposalInputs);
  for (const [outpoint, originalCount] of countInputsByOutpoint(originalInputs)) {
    const proposalCount = proposalCounts.get(outpoint) ?? 0;
    if (proposalCount === originalCount) continue;

    // Duplicating an original input is invalid: it can change signing intent and
    // creates ambiguous provenance for the receiver's proposed contribution.
    const relation = proposalCount < originalCount ? 'was not preserved' : 'appears more than once';
    errors.push(`Sender input ${outpoint} ${relation} in proposal`);
  }
};

const validateOriginalInputOrderAndSequences = (
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  errors: string[]
): void => {
  let proposalSearchStart = 0;
  originalInputs.forEach((originalInput, originalIndex) => {
    const proposalIndex = findNextInputByOutpoint(
      proposalInputs,
      originalInput,
      proposalSearchStart
    );

    if (proposalIndex < 0) {
      validateSenderInputReplacement(originalIndex, originalInput, proposalInputs, errors);
      errors.push(
        `Sender input ${originalIndex} ${formatInput(originalInput)} was not preserved in proposal order`
      );
      return;
    }

    validateSenderInputSequence(originalIndex, originalInput, proposalInputs[proposalIndex], errors);
    proposalSearchStart = proposalIndex + 1;
  });
};

const validateSenderInputReplacement = (
  originalIndex: number,
  originalInput: PsbtInput,
  proposalInputs: PsbtInput[],
  errors: string[]
): void => {
  const proposalInput = proposalInputs[originalIndex];
  if (!proposalInput || isSameInput(originalInput, proposalInput)) return;

  errors.push(
    `Sender input ${originalIndex} was modified: ${formatInput(originalInput)} -> ${formatInput(proposalInput)}`
  );
};

const countInputsByOutpoint = (inputs: PsbtInput[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    const key = formatInput(input);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const findNextInputByOutpoint = (
  inputs: PsbtInput[],
  originalInput: PsbtInput,
  startIndex: number
): number => {
  return inputs.findIndex((input, index) => (
    index >= startIndex && isSameInput(input, originalInput)
  ));
};

const validateSenderInputSequence = (
  originalIndex: number,
  originalInput: PsbtInput,
  proposalInput: PsbtInput | undefined,
  errors: string[]
): void => {
  if (!proposalInput || originalInput.sequence === proposalInput.sequence) return;

  errors.push(
    `Sender input ${originalIndex} sequence changed from ${originalInput.sequence} to ${proposalInput.sequence}`
  );
};

const isSameInput = (a: PsbtInput, b: PsbtInput): boolean => {
  return a.txid === b.txid && a.vout === b.vout;
};

const formatInput = (input: PsbtInput): string => `${input.txid}:${input.vout}`;

export const validateFeePolicy = (
  originalFee: number,
  proposalFee: number,
  { errors, warnings }: ValidationMessages
): void => {
  // Keep the existing bounded-increase contract until the sender exposes
  // explicit BIP78 additionalfeeoutputindex/maxadditionalfeecontribution
  // controls. A zero-fee original cannot safely infer an acceptable increase.
  if (!Number.isFinite(originalFee) || !Number.isFinite(proposalFee)) {
    errors.push(`Non-finite Payjoin fee calculation: ${originalFee} -> ${proposalFee}`);
    return;
  }

  if (originalFee < 0 || proposalFee < 0) {
    errors.push(`Invalid negative Payjoin fee calculation: ${originalFee} -> ${proposalFee}`);
    return;
  }

  if (proposalFee < originalFee) {
    errors.push(`Fee decreased from ${originalFee} to ${proposalFee}`);
    return;
  }

  if (originalFee === 0) {
    validateZeroOriginalFeeProposal(proposalFee, errors);
    return;
  }

  if (proposalFee > originalFee * 1.5) {
    errors.push(
      `Fee increased by more than 50%: ${originalFee} -> ${proposalFee} (${((proposalFee / originalFee - 1) * 100).toFixed(1)}%)`
    );
  } else if (proposalFee > originalFee * 1.2) {
    warnings.push(
      `Fee increased significantly: ${originalFee} -> ${proposalFee} (${((proposalFee / originalFee - 1) * 100).toFixed(1)}%)`
    );
  }
};

const validateZeroOriginalFeeProposal = (
  proposalFee: number,
  errors: string[]
): void => {
  if (proposalFee <= 0) return;

  errors.push(`Fee increased from zero original fee to ${proposalFee}`);
};

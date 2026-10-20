/**
 * Sender-side Payjoin proposal integrity checks.
 *
 * These helpers enforce the BIP78 sender safety boundary before a receiver's
 * proposal is returned for signing: original transaction fields, sender inputs,
 * sender outputs, and fee policy must remain within the sender's intent, and
 * the per-input/per-output PSBT maps must follow the BIP78 senders' checklist.
 */
import * as bitcoin from 'bitcoinjs-lib';
import type { PsbtInput, PsbtOutput, ValidationResult } from './psbtValidation';
import { isWitnessProgram } from './transactionWeight';

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

/**
 * Shared fee preconditions. False when the comparison cannot continue: a
 * non-finite, negative or decreased fee, or a zero-fee original (which cannot
 * safely infer an acceptable increase).
 */
const validateFeeAmounts = (originalFee: number, proposalFee: number, errors: string[]): boolean => {
  if (!Number.isFinite(originalFee) || !Number.isFinite(proposalFee)) {
    errors.push(`Non-finite Payjoin fee calculation: ${originalFee} -> ${proposalFee}`);
    return false;
  }

  if (originalFee < 0 || proposalFee < 0) {
    errors.push(`Invalid negative Payjoin fee calculation: ${originalFee} -> ${proposalFee}`);
    return false;
  }

  if (proposalFee < originalFee) {
    errors.push(`Fee decreased from ${originalFee} to ${proposalFee}`);
    return false;
  }

  if (originalFee === 0) {
    validateZeroOriginalFeeProposal(proposalFee, errors);
    return false;
  }
  return true;
};

/** Error above +50%, warning above +20%. */
const validateBoundedIncrease = (
  label: string,
  before: number,
  after: number,
  { errors, warnings }: ValidationMessages
): void => {
  const increase = `${before} -> ${after} (${((after / before - 1) * 100).toFixed(1)}%)`;
  if (after > before * 1.5) {
    errors.push(`${label} increased by more than 50%: ${increase}`);
  } else if (after > before * 1.2) {
    warnings.push(`${label} increased significantly: ${increase}`);
  }
};

export const validateFeePolicy = (
  originalFee: number,
  proposalFee: number,
  messages: ValidationMessages
): void => {
  // Keep the existing bounded-increase contract until the sender exposes
  // explicit BIP78 additionalfeeoutputindex/maxadditionalfeecontribution
  // controls.
  if (!validateFeeAmounts(originalFee, proposalFee, messages.errors)) return;
  validateBoundedIncrease('Fee', originalFee, proposalFee, messages);
};

const validateZeroOriginalFeeProposal = (
  proposalFee: number,
  errors: string[]
): void => {
  if (proposalFee <= 0) return;

  errors.push(`Fee increased from zero original fee to ${proposalFee}`);
};

type PsbtInputMap = bitcoin.Psbt['data']['inputs'][number];
export type PayjoinScriptType = 'p2wpkh' | 'p2tr' | 'unsupported';

const outpointOf = (input: { hash: Uint8Array; index: number }): string => (
  `${Buffer.from(input.hash).toString('hex')}:${input.index}`
);

const inputsByOutpoint = (psbt: bitcoin.Psbt): Map<string, PsbtInputMap> => new Map(
  psbt.txInputs.map((input, index) => [outpointOf(input), psbt.data.inputs[index]])
);

const sameBytes = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean => (
  left && right ? Buffer.from(left).equals(Buffer.from(right)) : left === right
);

const sameUtxoData = (left: PsbtInputMap, right: PsbtInputMap): boolean => (
  sameBytes(left.witnessUtxo?.script, right.witnessUtxo?.script)
  && left.witnessUtxo?.value === right.witnessUtxo?.value
  && sameBytes(left.nonWitnessUtxo, right.nonWitnessUtxo)
);

/**
 * BIP78 receivers strip the sender inputs' UTXO data. Copy it back from the
 * original so fees and signing see the prevouts the sender authorized.
 * Deviation (C-D10): sender UTXO data the receiver left in place is accepted
 * only when byte-equal to the original's.
 */
export const restoreSenderInputPrevouts = (
  original: bitcoin.Psbt,
  proposal: bitcoin.Psbt,
  errors: string[]
): void => {
  const originalInputs = inputsByOutpoint(original);
  proposal.txInputs.forEach((txInput, index) => {
    const source = originalInputs.get(outpointOf(txInput));
    if (!source) return;
    const target = proposal.data.inputs[index];
    if (target.witnessUtxo || target.nonWitnessUtxo) {
      if (!sameUtxoData(target, source)) {
        errors.push(`Sender input ${index} UTXO data differs from the original`);
      }
      return;
    }
    if (source.witnessUtxo) {
      target.witnessUtxo = { script: Buffer.from(source.witnessUtxo.script), value: source.witnessUtxo.value };
    }
    if (source.nonWitnessUtxo) target.nonWitnessUtxo = Buffer.from(source.nonWitnessUtxo);
  });
};

/** The output an input spends: its witnessUtxo, or the spent output of its nonWitnessUtxo. */
export const inputPrevout = (
  psbt: bitcoin.Psbt,
  index: number,
): { script: Uint8Array; value: bigint } | undefined => {
  const input = psbt.data.inputs[index];
  if (input.witnessUtxo) return input.witnessUtxo;
  if (!input.nonWitnessUtxo) return undefined;
  return bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[index].index];
};

/** C-D4: the only prevout script types a payjoin input may spend. */
export const payjoinScriptType = (script: Uint8Array | undefined): PayjoinScriptType => {
  if (!script) return 'unsupported';
  if (isWitnessProgram(script, 0x00, 20)) return 'p2wpkh';
  if (isWitnessProgram(script, 0x51, 32)) return 'p2tr';
  return 'unsupported';
};

const prevoutScriptType = (psbt: bitcoin.Psbt, index: number): PayjoinScriptType => (
  payjoinScriptType(inputPrevout(psbt, index)?.script)
);

const hasUtxoData = (input: PsbtInputMap): boolean => Boolean(input.witnessUtxo || input.nonWitnessUtxo);

const validateNoKeyPaths = (proposal: bitcoin.Psbt, errors: string[]): void => {
  const carriesKeyPaths = (map: { bip32Derivation?: unknown[]; tapBip32Derivation?: unknown[] }) => (
    Boolean(map.bip32Derivation?.length || map.tapBip32Derivation?.length)
  );
  proposal.data.inputs.forEach((input, index) => {
    if (carriesKeyPaths(input)) errors.push(`Proposal input ${index} must not carry BIP32 key paths`);
  });
  proposal.data.outputs.forEach((output, index) => {
    if (carriesKeyPaths(output)) errors.push(`Proposal output ${index} must not carry BIP32 key paths`);
  });
};

const validateNoInputSignatures = (proposal: bitcoin.Psbt, errors: string[]): void => {
  proposal.data.inputs.forEach((input, index) => {
    if (input.partialSig?.length || input.tapKeySig || input.tapScriptSig?.length) {
      errors.push(`Proposal input ${index} must not carry signatures`);
    }
  });
};

const validateSenderInputsNotFinalized = (
  proposal: bitcoin.Psbt,
  senderIndexes: number[],
  errors: string[]
): void => {
  senderIndexes.forEach(index => {
    const input = proposal.data.inputs[index];
    if (input.finalScriptSig || input.finalScriptWitness) {
      errors.push(`Sender input ${index} must not be finalized in the proposal`);
    }
  });
};

const validateReceiverInputsFinalized = (
  proposal: bitcoin.Psbt,
  receiverIndexes: number[],
  errors: string[]
): void => {
  receiverIndexes.forEach(index => {
    const input = proposal.data.inputs[index];
    if (input.finalScriptSig?.length) {
      errors.push(`Receiver input ${index} must not carry a non-empty finalScriptSig`);
    } else if (!input.finalScriptWitness) {
      errors.push(`Receiver input ${index} must be finalized with a witness`);
    }
    if (!hasUtxoData(input)) errors.push(`Receiver input ${index} is missing UTXO data`);
  });
};

/** C-D4 peer script types and the C-D10 mixed-input-type rule. */
const validateReceiverInputScriptTypes = (
  proposal: bitcoin.Psbt,
  senderIndexes: number[],
  receiverIndexes: number[],
  errors: string[]
): void => {
  const senderTypes = [...new Set(senderIndexes.map(index => prevoutScriptType(proposal, index)))];
  receiverIndexes.forEach(index => {
    if (!hasUtxoData(proposal.data.inputs[index])) return;
    const type = prevoutScriptType(proposal, index);
    if (type === 'unsupported') {
      errors.push(`Receiver input ${index} script type ${type} is not P2WPKH or P2TR`);
    } else if (senderTypes.length !== 1 || senderTypes[0] !== type) {
      errors.push(`Receiver input ${index} script type ${type} does not match sender input type ${senderTypes.join(',')}`);
    }
  });
};

/**
 * A receiver must not weaken what the sender's signatures commit to: every
 * input either leaves PSBT_IN_SIGHASH_TYPE unset or asks for SIGHASH_ALL
 * (SIGHASH_DEFAULT on a P2TR input is the same commitment).
 */
const validateSighashTypes = (proposal: bitcoin.Psbt, errors: string[]): void => {
  const { SIGHASH_ALL, SIGHASH_DEFAULT } = bitcoin.Transaction;
  proposal.data.inputs.forEach(({ sighashType }, index) => {
    if (sighashType === undefined || sighashType === SIGHASH_ALL) return;
    if (sighashType === SIGHASH_DEFAULT && prevoutScriptType(proposal, index) === 'p2tr') return;
    errors.push(`Proposal input ${index} must not request sighash type 0x${sighashType.toString(16).padStart(2, '0')}`);
  });
};

const validateUniformSequence = (proposal: bitcoin.Psbt, errors: string[]): void => {
  if (new Set(proposal.txInputs.map(input => input.sequence)).size > 1) {
    errors.push('Proposal inputs use mixed sequences');
  }
};

const validateReceiverInputPresent = (receiverIndexes: number[], errors: string[]): void => {
  if (receiverIndexes.length === 0) {
    errors.push('Receiver did not add any inputs - this is not a proper Payjoin');
  }
};

/**
 * BIP78 senders' payjoin proposal checklist for the per-input and per-output
 * PSBT maps. Run after restoreSenderInputPrevouts so sender script types come
 * from the original's prevouts.
 */
export const validateProposalInputMaps = (
  original: bitcoin.Psbt,
  proposal: bitcoin.Psbt,
  errors: string[]
): void => {
  const originalOutpoints = new Set(original.txInputs.map(outpointOf));
  const senderIndexes: number[] = [];
  const receiverIndexes: number[] = [];
  proposal.txInputs.forEach((input, index) => {
    (originalOutpoints.has(outpointOf(input)) ? senderIndexes : receiverIndexes).push(index);
  });

  validateNoKeyPaths(proposal, errors);
  validateNoInputSignatures(proposal, errors);
  validateSighashTypes(proposal, errors);
  validateSenderInputsNotFinalized(proposal, senderIndexes, errors);
  validateReceiverInputsFinalized(proposal, receiverIndexes, errors);
  validateReceiverInputScriptTypes(proposal, senderIndexes, receiverIndexes, errors);
  validateUniformSequence(proposal, errors);
  validateReceiverInputPresent(receiverIndexes, errors);
};

/**
 * Size of the proposal with the sender inputs finalized exactly as in the
 * finalized original, so its fee rate is comparable with the original's own.
 */
const measuredProposalVsize = (original: bitcoin.Psbt, proposal: bitcoin.Psbt): number => {
  const originalInputs = inputsByOutpoint(original);
  const measured = proposal.clone();
  measured.txInputs.forEach((txInput, index) => {
    const source = originalInputs.get(outpointOf(txInput));
    if (!source) return;
    const target = measured.data.inputs[index];
    if (source.finalScriptWitness) target.finalScriptWitness = source.finalScriptWitness;
    if (source.finalScriptSig) target.finalScriptSig = source.finalScriptSig;
  });
  return measured.extractTransaction(true).virtualSize();
};

/**
 * Fee policy when the sender sent BIP78 `minfeerate` (the original's rate):
 * the proposal must pay at least that rate, and the bounded-increase contract
 * applies to the rate. Every fee increase is receiver-funded (sender inputs are
 * fixed and sender outputs cannot decrease), and keeping the rate after adding
 * an input needs more than +50% absolute fee on a one-input original.
 */
export const validateMinFeeRatePolicy = (
  original: bitcoin.Psbt,
  proposal: bitcoin.Psbt,
  { originalFee, proposalFee, minFeeRate }: { originalFee: number; proposalFee: number; minFeeRate: number },
  messages: ValidationMessages
): void => {
  if (!validateFeeAmounts(originalFee, proposalFee, messages.errors)) return;
  const feeRate = proposalFee / measuredProposalVsize(original, proposal);
  if (feeRate < minFeeRate) {
    messages.errors.push(`Proposal fee rate ${feeRate.toFixed(3)} sat/vB is below the minfeerate ${minFeeRate} sat/vB`);
    return;
  }
  if (minFeeRate > 0) validateBoundedIncrease('Fee rate', minFeeRate, Number(feeRate.toFixed(3)), messages);
};

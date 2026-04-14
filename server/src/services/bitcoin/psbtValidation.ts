/**
 * PSBT Validation Utilities for Payjoin (BIP78)
 *
 * Provides validation and comparison functions for Payjoin PSBTs:
 * - Validate original PSBT format and structure
 * - Validate Payjoin proposal against original
 * - Ensure BIP78 compliance
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getErrorMessage } from '../../utils/errors';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PsbtOutput {
  address: string;
  value: number;
}

export interface PsbtInput {
  txid: string;
  vout: number;
  sequence: number;
}

type ValidationMessages = Pick<ValidationResult, 'errors' | 'warnings'>;

/**
 * Parse PSBT from base64 string
 */
export function parsePsbt(
  psbtBase64: string,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(psbtBase64, { network });
  } catch (error) {
    throw new Error(`Invalid PSBT format: ${getErrorMessage(error)}`);
  }
}

/**
 * Get inputs from a PSBT
 */
export function getPsbtInputs(psbt: bitcoin.Psbt): PsbtInput[] {
  return psbt.txInputs.map(input => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
    sequence: input.sequence ?? 0xffffffff,
  }));
}

/**
 * Get outputs from a PSBT
 */
export function getPsbtOutputs(
  psbt: bitcoin.Psbt,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): PsbtOutput[] {
  return psbt.txOutputs.map(output => {
    let address = '';
    try {
      address = bitcoin.address.fromOutputScript(output.script, network);
    } catch {
      address = 'unknown';
    }
    return {
      address,
      value: Number(output.value),
    };
  });
}

/**
 * Validate basic PSBT structure
 */
export function validatePsbtStructure(psbtBase64: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const psbt = parsePsbt(psbtBase64);

    // Check has inputs
    if (psbt.inputCount === 0) {
      errors.push('PSBT has no inputs');
    }

    // Check has outputs
    if (psbt.txOutputs.length === 0) {
      errors.push('PSBT has no outputs');
    }

    // Check inputs have required data
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (!input.witnessUtxo && !input.nonWitnessUtxo) {
        warnings.push(`Input ${i} missing UTXO data`);
      }
    }
  } catch (error) {
    errors.push(`Failed to parse PSBT: ${getErrorMessage(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a Payjoin proposal against the original PSBT
 * Implements BIP78 validation rules
 */
export function validatePayjoinProposal(
  originalBase64: string,
  proposalBase64: string,
  senderInputIndices: number[],
  network: bitcoin.Network = bitcoin.networks.bitcoin
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const original = parsePsbt(originalBase64, network);
    const proposal = parsePsbt(proposalBase64, network);

    const originalOutputs = getPsbtOutputs(original, network);
    const proposalOutputs = getPsbtOutputs(proposal, network);
    const originalInputs = getPsbtInputs(original);
    const proposalInputs = getPsbtInputs(proposal);

    validateSenderOutputs(originalOutputs, proposalOutputs, { errors, warnings });
    validateSenderInputs(senderInputIndices, originalInputs, proposalInputs, { errors, warnings });
    validateFeeIncrease(original, proposal, { errors, warnings });
    validateProposalInputCount(originalInputs, proposalInputs, { errors, warnings });
    validateReceiverContribution(originalInputs, proposalInputs, { errors, warnings });

  } catch (error) {
    errors.push(`Validation failed: ${getErrorMessage(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

const validateSenderOutputs = (
  originalOutputs: PsbtOutput[],
  proposalOutputs: PsbtOutput[],
  messages: ValidationMessages
): void => {
  for (const origOutput of originalOutputs) {
    if (origOutput.address === 'unknown') continue;

    const matchingOutput = proposalOutputs.find(
      output => output.address === origOutput.address
    );

    validateSenderOutput(origOutput, matchingOutput, messages);
  }
};

const validateSenderOutput = (
  origOutput: PsbtOutput,
  matchingOutput: PsbtOutput | undefined,
  { errors, warnings }: ValidationMessages
): void => {
  if (!matchingOutput) {
    errors.push(`Original output to ${origOutput.address} was removed`);
  } else if (matchingOutput.value < origOutput.value) {
    errors.push(
      `Output to ${origOutput.address} decreased from ${origOutput.value} to ${matchingOutput.value}`
    );
  } else if (matchingOutput.value > origOutput.value) {
    // This is allowed - receiver can contribute more
    warnings.push(
      `Output to ${origOutput.address} increased from ${origOutput.value} to ${matchingOutput.value}`
    );
  }
};

const validateSenderInputs = (
  senderInputIndices: number[],
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  { errors }: ValidationMessages
): void => {
  for (const idx of senderInputIndices) {
    if (!hasOriginalSenderInput(idx, originalInputs, errors)) continue;
    if (!hasProposalSenderInput(idx, proposalInputs, errors)) continue;

    validateSenderInputUnchanged(idx, originalInputs[idx], proposalInputs[idx], errors);
  }
};

const hasOriginalSenderInput = (idx: number, originalInputs: PsbtInput[], errors: string[]): boolean => {
  if (idx < originalInputs.length) return true;

  errors.push(`Sender input index ${idx} out of range`);
  return false;
};

const hasProposalSenderInput = (idx: number, proposalInputs: PsbtInput[], errors: string[]): boolean => {
  if (idx < proposalInputs.length) return true;

  errors.push(`Sender input ${idx} was removed from proposal`);
  return false;
};

const validateSenderInputUnchanged = (
  idx: number,
  origInput: PsbtInput,
  propInput: PsbtInput,
  errors: string[]
): void => {
  if (origInput.txid === propInput.txid && origInput.vout === propInput.vout) return;

  errors.push(
    `Sender input ${idx} was modified: ${origInput.txid}:${origInput.vout} -> ${propInput.txid}:${propInput.vout}`
  );
};

const validateFeeIncrease = (
  original: bitcoin.Psbt,
  proposal: bitcoin.Psbt,
  { errors, warnings }: ValidationMessages
): void => {
  const originalFee = calculatePsbtFee(original);
  const proposalFee = calculatePsbtFee(proposal);

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

const validateProposalInputCount = (
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  { errors }: ValidationMessages
): void => {
  if (proposalInputs.length >= originalInputs.length) return;

  errors.push(
    `Proposal has fewer inputs than original: ${proposalInputs.length} < ${originalInputs.length}`
  );
};

const validateReceiverContribution = (
  originalInputs: PsbtInput[],
  proposalInputs: PsbtInput[],
  { warnings }: ValidationMessages
): void => {
  const newInputs = proposalInputs.filter(
    propInput => !originalInputs.some(origInput => isSameInput(origInput, propInput))
  );

  if (newInputs.length === 0) {
    warnings.push('Receiver did not add any inputs - this is not a proper Payjoin');
  }
};

const isSameInput = (a: PsbtInput, b: PsbtInput): boolean => {
  return a.txid === b.txid && a.vout === b.vout;
};

/**
 * Check if a transaction is RBF-enabled (has any input with sequence < 0xfffffffe)
 */
export function isRbfEnabled(psbt: bitcoin.Psbt): boolean {
  return psbt.txInputs.some(input => (input.sequence ?? 0xffffffff) < 0xfffffffe);
}

/**
 * Calculate the virtual size of a PSBT
 */
export function calculateVSize(psbt: bitcoin.Psbt): number {
  try {
    // Try to extract the transaction for accurate vsize
    const tx = psbt.extractTransaction(true);
    return tx.virtualSize();
  } catch {
    // Estimate based on input/output counts
    const inputCount = psbt.inputCount;
    const outputCount = psbt.txOutputs.length;
    // Rough estimation for P2WPKH
    return 10.5 + inputCount * 68 + outputCount * 34;
  }
}

/**
 * Calculate the total fee of a PSBT (inputTotal - outputTotal)
 */
export function calculatePsbtFee(psbt: bitcoin.Psbt): number {
  let inputTotal = 0;

  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo) {
      inputTotal += Number(input.witnessUtxo.value);
    } else if (input.nonWitnessUtxo) {
      const tx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
      inputTotal += Number(tx.outs[psbt.txInputs[i].index].value);
    }
  }

  const outputTotal = psbt.txOutputs.reduce((sum, out) => sum + Number(out.value), 0);
  return inputTotal - outputTotal;
}

/**
 * Calculate fee rate of a PSBT
 */
export function calculateFeeRate(psbt: bitcoin.Psbt): number {
  const fee = calculatePsbtFee(psbt);
  const vsize = calculateVSize(psbt);

  return vsize > 0 ? fee / vsize : 0;
}

/**
 * Clone a PSBT
 */
export function clonePsbt(psbt: bitcoin.Psbt): bitcoin.Psbt {
  return bitcoin.Psbt.fromBase64(psbt.toBase64());
}

/**
 * Merge receiver's signed inputs into sender's PSBT
 */
export function mergeSignedInputs(
  senderPsbt: bitcoin.Psbt,
  receiverPsbt: bitcoin.Psbt,
  receiverInputIndices: number[]
): bitcoin.Psbt {
  const merged = clonePsbt(senderPsbt);

  for (const idx of receiverInputIndices) {
    if (idx >= receiverPsbt.inputCount) continue;

    const receiverInput = receiverPsbt.data.inputs[idx];

    // Copy signature data from receiver
    if (receiverInput.partialSig) {
      merged.data.inputs[idx].partialSig = receiverInput.partialSig;
    }
    if (receiverInput.finalScriptSig) {
      merged.data.inputs[idx].finalScriptSig = receiverInput.finalScriptSig;
    }
    if (receiverInput.finalScriptWitness) {
      merged.data.inputs[idx].finalScriptWitness = receiverInput.finalScriptWitness;
    }
  }

  return merged;
}

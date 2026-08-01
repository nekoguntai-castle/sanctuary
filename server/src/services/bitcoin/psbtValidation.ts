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
import {
  resolveLegacySenderInputIndices,
  resolvePayjoinNetwork,
  validateFeePolicy,
  validateLegacySenderInputIndices,
  validateSenderInputs,
  validateSenderOutputs,
  validateTransactionFields,
} from './payjoinProposalValidation';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PsbtOutput {
  address: string;
  value: number;
  scriptHex: string;
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
      scriptHex: Buffer.from(output.script).toString('hex'),
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
 * Implements BIP78 validation rules.
 *
 * The third parameter accepts a bitcoin.Network. Passing sender input indices is
 * a deprecated compatibility form; indices are used only for legacy diagnostics
 * and cannot weaken the sender-input invariant derived from the original PSBT.
 */
export function validatePayjoinProposal(
  originalBase64: string,
  proposalBase64: string,
  networkOrSenderInputIndices: bitcoin.Network | number[] = bitcoin.networks.bitcoin,
  legacyNetwork: bitcoin.Network = bitcoin.networks.bitcoin
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const network = resolvePayjoinNetwork(networkOrSenderInputIndices, legacyNetwork);
    const legacySenderInputIndices = resolveLegacySenderInputIndices(networkOrSenderInputIndices);
    const original = parsePsbt(originalBase64, network);
    const proposal = parsePsbt(proposalBase64, network);

    const originalOutputs = getPsbtOutputs(original, network);
    const proposalOutputs = getPsbtOutputs(proposal, network);
    const originalInputs = getPsbtInputs(original);
    const proposalInputs = getPsbtInputs(proposal);

    validateTransactionFields(original, proposal, { errors, warnings });
    validateSenderOutputs(originalOutputs, proposalOutputs, { errors, warnings });
    validateLegacySenderInputIndices(legacySenderInputIndices, originalInputs, errors);
    validateSenderInputs(originalInputs, proposalInputs, { errors, warnings });
    validateFeePolicy(calculatePsbtFee(original), calculatePsbtFee(proposal), { errors, warnings });
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

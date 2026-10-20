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
  restoreSenderInputPrevouts,
  validateFeePolicy,
  validateLegacySenderInputIndices,
  validateMinFeeRatePolicy,
  validateProposalInputMaps,
  validateSenderInputs,
  validateSenderOutputs,
  validateTransactionFields,
} from './payjoinProposalValidation';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Payjoin only: the proposal with sender prevouts restored, present only when valid. */
  proposalPsbt?: string;
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

export interface PayjoinProposalValidationOptions {
  /** BIP78 minfeerate in sat/vB that the proposal must meet. */
  minFeeRate?: number;
}

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
 *
 * BIP78 receivers strip the sender inputs' UTXO data, so it is restored from
 * the original before the per-input checklist and the fee check run. The fee
 * check is skipped once the checklist reports an error (a receiver input
 * without UTXO data has no computable fee). A valid result carries the
 * restored proposal as `proposalPsbt`. With `minFeeRate` (the BIP78
 * minfeerate the sender sent), a proposal paying a lower rate is rejected and
 * the bounded fee increase applies to the rate instead of the absolute fee;
 * the original must then be finalized, as BIP78 requires.
 */
export function validatePayjoinProposal(
  originalBase64: string,
  proposalBase64: string,
  networkOrSenderInputIndices: bitcoin.Network | number[] = bitcoin.networks.bitcoin,
  legacyNetwork: bitcoin.Network = bitcoin.networks.bitcoin,
  { minFeeRate }: PayjoinProposalValidationOptions = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let proposalPsbt: string | undefined;

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
    const errorsBeforeInputMaps = errors.length;
    restoreSenderInputPrevouts(original, proposal, errors);
    validateProposalInputMaps(original, proposal, errors);
    if (errors.length === errorsBeforeInputMaps) {
      const fees = { originalFee: calculatePsbtFee(original), proposalFee: calculatePsbtFee(proposal) };
      if (minFeeRate === undefined) {
        validateFeePolicy(fees.originalFee, fees.proposalFee, { errors, warnings });
      } else {
        validateMinFeeRatePolicy(original, proposal, { ...fees, minFeeRate }, { errors, warnings });
      }
    }
    validateProposalInputCount(originalInputs, proposalInputs, { errors, warnings });
    if (errors.length === 0) proposalPsbt = proposal.toBase64();
  } catch (error) {
    errors.push(`Validation failed: ${getErrorMessage(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ...(proposalPsbt !== undefined && { proposalPsbt }),
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
    } else {
      // Skipping the input would understate the fee; callers catch this.
      throw new Error(`Input ${i} is missing UTXO data`);
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

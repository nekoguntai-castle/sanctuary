import * as bitcoin from 'bitcoinjs-lib';
import { InvalidInputError } from '../../../errors/ApiError';
import {
  SIGNING_INTENT_MAX_FEE_RATE,
  SIGNING_INTENT_MIN_FEE_RATE,
  type SigningIntentFeePolicyV1,
} from './types';
import { parseMultisigScript } from '../psbtBuilder';
import { estimateTransactionWeight, type TransactionWeightInput } from '../transactionWeight';

// Maximum configured dust remainder (9,999 sats) plus the largest supported
// omitted standard output (43 vbytes), plus the largest CompactSize count
// transition (2 bytes), at the maximum admitted 1,000 sat/vB.
export const MAX_SIGNING_INTENT_DUST_ABSORPTION_SATS = 54_999;

const previousOutput = (psbt: bitcoin.Psbt, index: number): { value: bigint; script: Uint8Array } => {
  const data = psbt.data.inputs[index];
  const witnessOutput = data.witnessUtxo
    ? { value: BigInt(data.witnessUtxo.value), script: data.witnessUtxo.script }
    : undefined;
  if (data.nonWitnessUtxo) {
    const previous = bitcoin.Transaction.fromBuffer(data.nonWitnessUtxo);
    const output = previous.outs[psbt.txInputs[index].index];
    if (output) {
      const nonWitnessOutput = { value: BigInt(output.value), script: output.script };
      if (
        witnessOutput &&
        (witnessOutput.value !== nonWitnessOutput.value ||
          !Buffer.from(witnessOutput.script).equals(Buffer.from(nonWitnessOutput.script)))
      ) {
        throw new InvalidInputError('PSBT prevout evidence is inconsistent', `inputs.${index}`, {
          reason: 'prevout_evidence_mismatch',
        });
      }
      return nonWitnessOutput;
    }
  }
  if (witnessOutput) return witnessOutput;
  throw new InvalidInputError('Cannot authorize a fee without complete prevout values', `inputs.${index}`, {
    reason: 'unknown_input_value',
  });
};

const isScript = (script: Uint8Array, prefix: readonly number[], length: number): boolean =>
  script.length === length && prefix.every((byte, index) => script[index] === byte);

const weightInput = (psbt: bitcoin.Psbt, index: number): TransactionWeightInput => {
  const data = psbt.data.inputs[index];
  const prevoutScript = previousOutput(psbt, index).script;
  if (isScript(prevoutScript, [0x76, 0xa9, 0x14], 25)) {
    return { spendPolicy: { type: 'p2pkh' }, prevoutScript };
  }
  if (isScript(prevoutScript, [0x00, 0x14], 22)) {
    return { spendPolicy: { type: 'p2wpkh' }, prevoutScript };
  }
  if (isScript(prevoutScript, [0x51, 0x20], 34)) {
    return { spendPolicy: { type: 'p2tr-keypath' }, prevoutScript };
  }
  if (data.witnessScript) {
    const parsed = parseMultisigScript(data.witnessScript);
    if (!parsed.isMultisig) throw new InvalidInputError('PSBT witness script is not supported', `inputs.${index}`);
    if (isScript(prevoutScript, [0x00, 0x20], 34)) {
      return {
        spendPolicy: { type: 'p2wsh-sortedmulti', m: parsed.m, n: parsed.n },
        prevoutScript,
        witnessScript: data.witnessScript,
      };
    }
    if (isScript(prevoutScript, [0xa9, 0x14], 23) && data.redeemScript) {
      return {
        spendPolicy: { type: 'p2sh-p2wsh-sortedmulti', m: parsed.m, n: parsed.n },
        prevoutScript,
        redeemScript: data.redeemScript,
        witnessScript: data.witnessScript,
      };
    }
  }
  if (isScript(prevoutScript, [0xa9, 0x14], 23) && data.redeemScript) {
    return { spendPolicy: { type: 'p2sh-p2wpkh' }, prevoutScript, redeemScript: data.redeemScript };
  }
  throw new InvalidInputError('PSBT input spend policy is unsupported', `inputs.${index}`);
};

export const estimatePsbtMaximumSignedVsize = (psbt: bitcoin.Psbt): number => estimateTransactionWeight({
  inputs: psbt.txInputs.map((_input, index) => weightInput(psbt, index)),
  outputs: psbt.txOutputs.map(output => ({ scriptPubKey: output.script })),
}).vsize;

export const calculatePsbtFee = (psbt: bitcoin.Psbt): number => {
  const inputs = psbt.txInputs.reduce((sum, _input, index) => sum + previousOutput(psbt, index).value, 0n);
  const outputs = psbt.txOutputs.reduce((sum, output) => sum + BigInt(output.value), 0n);
  const fee = inputs - outputs;
  if (fee < 0n || fee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError('Unsigned PSBT fee is outside the supported range', 'fee', {
      reason: fee < 0n ? 'fee_too_low' : 'fee_too_high',
    });
  }
  return Number(fee);
};

/**
 * Bind an unsigned PSBT to its exact authenticated fee and conservative maximum
 * signed size. `expectedFeeSats` cross-checks the builder's accounting, while
 * `maximumDustAbsorptionSats` is the only allowed excess over the requested-rate
 * ceiling and must come from an independently bounded no-change decision.
 */
export const buildSigningIntentFeePolicy = (
  psbtBase64: string,
  requestedFeeRateSatsPerVbyte: number,
  expectedFeeSats?: number,
  maximumDustAbsorptionSats = 0,
): SigningIntentFeePolicyV1 => {
  if (
    !Number.isFinite(requestedFeeRateSatsPerVbyte) ||
    requestedFeeRateSatsPerVbyte < SIGNING_INTENT_MIN_FEE_RATE ||
    requestedFeeRateSatsPerVbyte > SIGNING_INTENT_MAX_FEE_RATE
  ) {
    throw new InvalidInputError(
      `Fee rate must be between ${SIGNING_INTENT_MIN_FEE_RATE} and ${SIGNING_INTENT_MAX_FEE_RATE} sat/vB`,
      'feeRate',
    );
  }
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
  const authenticatedFee = calculatePsbtFee(psbt);
  if (expectedFeeSats !== undefined && expectedFeeSats !== authenticatedFee) {
    throw new InvalidInputError('Constructed transaction fee does not match its PSBT', 'fee', {
      reason: expectedFeeSats < authenticatedFee ? 'fee_too_low' : 'fee_too_high',
      expectedFeeSats,
      actualFeeSats: authenticatedFee,
    });
  }
  const unsigned = bitcoin.Transaction.fromBuffer(
    Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()),
  );
  const unsignedFloorFee = Math.ceil(requestedFeeRateSatsPerVbyte * unsigned.virtualSize());
  if (
    !Number.isSafeInteger(maximumDustAbsorptionSats) ||
    maximumDustAbsorptionSats < 0 ||
    maximumDustAbsorptionSats > MAX_SIGNING_INTENT_DUST_ABSORPTION_SATS
  ) {
    throw new InvalidInputError('Fee dust allowance is outside the supported range', 'fee', {
      reason: 'fee_too_high',
    });
  }
  const maximumSignedFee = Math.ceil(
    requestedFeeRateSatsPerVbyte * estimatePsbtMaximumSignedVsize(psbt),
  );
  const maximumAuthorizedSurplus = maximumDustAbsorptionSats;
  const dustAbsorption = authenticatedFee - maximumSignedFee;
  if (dustAbsorption < 0 || dustAbsorption > maximumAuthorizedSurplus) {
    throw new InvalidInputError('Constructed transaction fee is outside the requested policy', 'fee', {
      reason: dustAbsorption < 0 ? 'fee_too_low' : 'fee_too_high',
      expectedFeeSats: maximumSignedFee,
      actualFeeSats: authenticatedFee,
      maximumDustAbsorptionSats: maximumAuthorizedSurplus,
    });
  }
  const serializationToleranceSats = maximumSignedFee - unsignedFloorFee;
  return {
    version: 1,
    expectedFeeSats: authenticatedFee,
    requestedFeeRateSatsPerVbyte,
    roundingMode: 'ceil',
    // This width is independent of the fee being authorized: it consists only
    // of the exact unsigned-to-conservative-signed serialization range plus an
    // explicit builder-provided dust allowance. A missing change output cannot
    // widen its own authorization.
    roundingToleranceSats: serializationToleranceSats + maximumAuthorizedSurplus,
  };
};

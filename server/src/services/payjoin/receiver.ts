/**
 * Payjoin Receiver (BIP78)
 *
 * Process incoming Payjoin requests where we are the receiver.
 * Validates the original PSBT and checks that a contribution UTXO exists, then
 * fails closed with BIP78 `unavailable`: a valid proposal needs a finalized
 * receiver input, and receiver input signing is not implemented yet.
 */

import { addressRepository, utxoRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  parsePsbt,
  validatePsbtStructure,
  getPsbtOutputs,
  calculateFeeRate,
} from '../bitcoin/psbtValidation';
import { getNetwork } from '../bitcoin/utils';
import { normalizeLegacyBitcoinNetwork } from '../bitcoin/networks';
import { PayjoinErrors } from './types';
import type { PayjoinResult } from './types';
import { assertWalletHardwareCapabilityById } from '../hardwareWalletCapabilities';

const log = createLogger('PAYJOIN:SVC_RECV');

/**
 * Process an incoming Payjoin request (we're the receiver)
 *
 * Steps:
 * 1. Validate the original PSBT: structure, finalized inputs with UTXO data
 * 2. Find the output paying to our address
 * 3. Confirm a UTXO is available to contribute
 * 4. Return `unavailable`: building a proposal requires signing the receiver
 *    input, which is not implemented, so no proposal PSBT is ever returned
 */
export async function processPayjoinRequest(
  addressId: string,
  originalPsbtBase64: string,
  minFeeRate: number = 1
): Promise<PayjoinResult> {
  try {
    // Get address and wallet info
    const address = await addressRepository.findByIdWithWallet(addressId);

    if (!address) {
      log.warn('Payjoin request for unknown address', { addressId });
      return {
        success: false,
        error: PayjoinErrors.UNAVAILABLE,
        errorMessage: 'Address not found',
      };
    }

    await assertWalletHardwareCapabilityById(address.wallet.id, 'sign');

    const network = getNetwork(normalizeLegacyBitcoinNetwork(address.wallet.network, 'mainnet'));

    // Validate original PSBT structure
    const structureValidation = validatePsbtStructure(originalPsbtBase64);
    if (!structureValidation.valid) {
      log.warn('Invalid original PSBT structure', { errors: structureValidation.errors });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: structureValidation.errors.join(', '),
      };
    }

    const originalPsbt = parsePsbt(originalPsbtBase64, network);
    // BIP78: the original must be finalized (broadcastable) with every prevout
    // filled in. Checked inline: tests mock the psbtValidation module wholesale.
    const unbroadcastableInput = originalPsbt.data.inputs.findIndex(input => (
      !(input.finalScriptSig || input.finalScriptWitness) || !(input.witnessUtxo || input.nonWitnessUtxo)
    ));
    if (unbroadcastableInput !== -1) {
      log.warn('Original PSBT is not finalized with UTXO data', { input: unbroadcastableInput });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: `Original PSBT input ${unbroadcastableInput} must be finalized and carry UTXO data`,
      };
    }
    const originalOutputs = getPsbtOutputs(originalPsbt, network);

    // Find the output paying to our address
    const ourOutputIndex = originalOutputs.findIndex(o => o.address === address.address);
    if (ourOutputIndex === -1) {
      log.warn('No output to our address found', { address: address.address });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: 'No output to the receiving address',
      };
    }

    const paymentAmount = originalOutputs[ourOutputIndex].value;

    // Select a UTXO to contribute
    const contributionUtxo = await selectContributionUtxo(
      address.wallet.id,
      paymentAmount
    );

    if (!contributionUtxo) {
      log.info('No suitable UTXO for Payjoin contribution', { walletId: address.wallet.id });
      return {
        success: false,
        error: PayjoinErrors.NOT_ENOUGH_MONEY,
        errorMessage: 'No suitable UTXOs available for contribution',
      };
    }

    // Check fee rate meets minimum
    const originalFeeRate = calculateFeeRate(originalPsbt);
    if (originalFeeRate < minFeeRate) {
      log.warn('Original fee rate below minimum', { originalFeeRate, minFeeRate });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: `Fee rate ${originalFeeRate.toFixed(2)} below minimum ${minFeeRate}`,
      };
    }

    log.info('Payjoin receiver proposal unsupported: receiver input signing not implemented', { addressId });
    return {
      success: false,
      error: PayjoinErrors.UNAVAILABLE,
      errorMessage: 'Payjoin receiver proposals are unavailable until receiver input signing is implemented',
    };
  } catch (error) {
    log.error('Error processing Payjoin request', { error: getErrorMessage(error) });
    return {
      success: false,
      error: PayjoinErrors.RECEIVER_ERROR,
      errorMessage: getErrorMessage(error, 'Unknown error'),
    };
  }
}

/**
 * Select a UTXO to contribute to a Payjoin transaction
 *
 * Selection criteria:
 * - Prefer similar amount to payment (privacy)
 * - Avoid dust
 * - Require confirmations
 * - Not frozen or locked
 */
async function selectContributionUtxo(
  walletId: string,
  paymentAmount: number
): Promise<{
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: string;
} | null> {
  // Get available UTXOs
  const utxos = await utxoRepository.findAvailableForSpending(walletId, {
    minConfirmations: 1,
    excludeDraftLocked: true,
  });

  if (utxos.length === 0) return null;

  // Prefer UTXO closest in size to payment amount (within 2x)
  // This improves privacy by making it unclear which output is payment/change
  const targetMin = paymentAmount / 2;
  const targetMax = paymentAmount * 2;

  type UtxoRow = typeof utxos[number];

  const candidates = utxos.filter((u: UtxoRow) => {
    const amount = Number(u.amount);
    return amount >= targetMin && amount <= targetMax && amount > 1000; // Avoid dust
  });

  if (candidates.length > 0) {
    // Sort by closest to payment amount
    candidates.sort((a: UtxoRow, b: UtxoRow) => {
      const diffA = Math.abs(Number(a.amount) - paymentAmount);
      const diffB = Math.abs(Number(b.amount) - paymentAmount);
      return diffA - diffB;
    });
    return candidates[0];
  }

  // Fallback: use largest UTXO that's not dust
  const nonDust = utxos.filter((u: UtxoRow) => Number(u.amount) > 1000);
  if (nonDust.length > 0) {
    return nonDust[nonDust.length - 1]; // Largest
  }

  return null;
}

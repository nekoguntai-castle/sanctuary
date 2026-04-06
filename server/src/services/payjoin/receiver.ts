/**
 * Payjoin Receiver (BIP78)
 *
 * Process incoming Payjoin requests where we are the receiver.
 * Validates the original PSBT, selects a contribution UTXO,
 * and returns a modified proposal PSBT with our input added.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  parsePsbt,
  validatePsbtStructure,
  getPsbtOutputs,
  calculateFeeRate,
  clonePsbt,
} from '../bitcoin/psbtValidation';
import { getNetwork } from '../bitcoin/utils';
import { PayjoinErrors } from './types';
import type { PayjoinResult } from './types';

const log = createLogger('PAYJOIN:SVC_RECV');

/**
 * Process an incoming Payjoin request (we're the receiver)
 *
 * Steps:
 * 1. Validate the original PSBT
 * 2. Find the output paying to our address
 * 3. Select a UTXO to contribute
 * 4. Add our input to the PSBT
 * 5. Increase our output by our contribution amount
 * 6. Sign our input (if hot wallet)
 * 7. Return the modified PSBT
 */
export async function processPayjoinRequest(
  addressId: string,
  originalPsbtBase64: string,
  minFeeRate: number = 1
): Promise<PayjoinResult> {
  try {
    // Get address and wallet info
    const address = await prisma.address.findUnique({
      where: { id: addressId },
      include: {
        wallet: {
          select: {
            id: true,
            network: true,
            type: true,
            scriptType: true,
          },
        },
      },
    });

    if (!address) {
      log.warn('Payjoin request for unknown address', { addressId });
      return {
        success: false,
        error: PayjoinErrors.UNAVAILABLE,
        errorMessage: 'Address not found',
      };
    }

    const network = getNetwork(address.wallet.network as 'mainnet' | 'testnet' | 'regtest' || 'mainnet');

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

    // Build proposal PSBT
    const proposalPsbt = clonePsbt(originalPsbt);

    // Add our input
    const contributionAmount = Number(contributionUtxo.amount);
    proposalPsbt.addInput({
      hash: contributionUtxo.txid,
      index: contributionUtxo.vout,
      sequence: 0xfffffffd, // RBF enabled
      // For P2WPKH, we need to add witnessUtxo
      witnessUtxo: {
        script: Buffer.from(contributionUtxo.scriptPubKey, 'hex'),
        value: contributionAmount,
      },
    });

    // Increase our output by contribution amount
    // The output value needs to be updated
    const newOutputValue = paymentAmount + contributionAmount;
    proposalPsbt.txOutputs[ourOutputIndex].value = newOutputValue;

    // Note: In a full implementation, we would sign our input here
    // For now, we return the unsigned proposal
    // The receiver would need to sign with their key

    log.info('Payjoin proposal created', {
      addressId,
      paymentAmount,
      contributionAmount,
      newOutputValue,
    });

    return {
      success: true,
      proposalPsbt: proposalPsbt.toBase64(),
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
  const utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
      confirmations: { gt: 0 },
      draftLock: null, // Not locked by a draft
    },
    select: {
      id: true,
      txid: true,
      vout: true,
      amount: true,
      scriptPubKey: true,
    },
    orderBy: { amount: 'asc' },
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

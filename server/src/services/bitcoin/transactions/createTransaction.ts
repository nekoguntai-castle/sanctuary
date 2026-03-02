/**
 * Create Transaction Module
 *
 * Handles single-recipient transaction creation with PSBT construction.
 * Supports:
 * - Normal transactions (amount + fee from UTXOs)
 * - Send-max (entire balance minus fee)
 * - Subtract-fees (fee deducted from amount)
 * - Decoy change outputs (privacy enhancement)
 * - RBF (Replace-By-Fee) signaling
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import { RBF_SEQUENCE } from '../advancedTx';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { getDustThreshold } from '../estimation';
import { isLegacyScriptType } from './helpers';
import {
  resolveWalletSigningInfo,
  parseAccountNode,
  fetchRawTransactionsForLegacy,
  fetchAddressDerivationPaths,
  addInputsWithBip32,
} from './psbtConstruction';
import { selectUtxosForMode } from './utxoModes';
import { buildAndAddOutputs } from './outputBuilder';
import type { CreateTransactionResult } from './types';

const log = createLogger('CREATE-TX');

/**
 * Create a transaction
 */
export async function createTransaction(
  walletId: string,
  recipient: string,
  amount: number,
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
    sendMax?: boolean; // Send entire balance (no change output)
    subtractFees?: boolean; // Subtract fees from amount instead of adding
    decoyOutputs?: {
      enabled: boolean;
      count: number; // 2-4 additional outputs
    };
  } = {}
): Promise<CreateTransactionResult> {
  const { selectedUtxoIds, enableRBF = true, sendMax = false, subtractFees = false, decoyOutputs } = options;

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet info including devices (for fingerprint)
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  log.debug('createTransaction', { walletId, scriptType: wallet.scriptType });

  // Validate recipient address
  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Resolve wallet signing info (fingerprints, xpubs, multisig keys)
  const signingInfo = resolveWalletSigningInfo(wallet, 'BIP32 derivation: ');

  try {
    bitcoin.address.toOutputScript(recipient, networkObj);
  } catch (error) {
    throw new Error('Invalid recipient address');
  }

  // Select UTXOs based on transaction mode
  const { effectiveAmount, selection } = await selectUtxosForMode(
    walletId, amount, feeRate, dustThreshold, sendMax, subtractFees, selectedUtxoIds
  );

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const sequence = enableRBF ? RBF_SEQUENCE : 0xffffffff;
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // Fetch address derivation paths for inputs
  const utxoAddresses = selection.utxos.map(u => u.address);
  const addressPathMap = await fetchAddressDerivationPaths(walletId, utxoAddresses);

  // Parse account xpub for key derivation
  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;

  // Fetch raw transactions for legacy wallets
  const rawTxCache = isLegacy
    ? await fetchRawTransactionsForLegacy(selection.utxos.map(u => u.txid))
    : new Map<string, Buffer>();

  // Add inputs with BIP32 derivation info
  const inputPaths = addInputsWithBip32(psbt, selection.utxos, {
    sequence,
    isLegacy,
    rawTxCache,
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
  });

  // Build outputs (recipient + change/decoys) and add to PSBT
  const {
    changeAddress,
    decoyOutputsResult,
    actualFee,
    actualChangeAmount,
  } = await buildAndAddOutputs(
    psbt, walletId, recipient, effectiveAmount,
    selection, dustThreshold, sendMax, feeRate, decoyOutputs
  );

  // When decoys are used, don't return changeAmount/changeAddress separately
  const hasDecoys = decoyOutputsResult && decoyOutputsResult.length > 0;

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: actualFee,
    totalInput: selection.totalAmount,
    totalOutput: effectiveAmount + (sendMax ? 0 : (actualChangeAmount >= dustThreshold ? actualChangeAmount : 0)),
    changeAmount: hasDecoys ? 0 : (sendMax ? 0 : actualChangeAmount),
    changeAddress: hasDecoys ? undefined : changeAddress,
    utxos: selection.utxos.map((u) => ({ txid: u.txid, vout: u.vout, address: u.address, amount: Number(u.amount) })),
    inputPaths,
    effectiveAmount,
    decoyOutputs: decoyOutputsResult,
  };
}

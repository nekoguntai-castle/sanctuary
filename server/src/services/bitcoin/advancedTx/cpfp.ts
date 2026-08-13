/**
 * CPFP (Child-Pays-For-Parent) Transaction Support
 *
 * Implements Child-Pays-For-Parent functionality for accelerating
 * stuck unconfirmed transactions by spending their outputs with
 * a higher fee rate.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { getNetwork } from '../utils';
import { getNodeClient } from '../nodeClient';
import type { BitcoinNetwork } from '../networks';
import { normalizeLegacyBitcoinNetwork } from '../networks';
import { utxoRepository, walletRepository } from '../../../repositories';
import { getDustThreshold } from './shared';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import { bindPsbtAccount } from '../psbtAccountBinding';
import {
  addInputsWithBip32,
  fetchAddressDerivationPaths,
  parseAccountNode,
  resolveWalletSigningInfo,
} from '../transactions/psbtConstruction';
import { resolveTransactionSpendPolicy } from '../transactions/feePolicy';
import { estimateTransactionWeight, feeForRate } from '../transactionWeight';
import { buildSigningIntentFeePolicy } from '../signingIntent/feePolicy';
import type { SigningIntentFeePolicyV1 } from '../signingIntent/types';

/**
 * Calculate CPFP fee to achieve target fee rate
 */
export function calculateCPFPFee(
  parentTxSize: number,
  parentFeeRate: number,
  childTxSize: number,
  targetFeeRate: number,
  authenticatedParentFee?: number,
): {
  childFee: number;
  childFeeRate: number;
  totalFee: number;
  totalSize: number;
  effectiveFeeRate: number;
} {
  const parentFee = authenticatedParentFee ?? (
    parentFeeRate === 0 ? 0 : feeForRate(parentTxSize, parentFeeRate)
  );

  // Calculate total fee needed for target rate
  const totalSize = parentTxSize + childTxSize;
  const totalFee = feeForRate(totalSize, targetFeeRate);

  // Child fee is the difference
  const childFee = totalFee - parentFee;
  const childFeeRate = Math.ceil(childFee / childTxSize);

  // Effective fee rate for the package
  const effectiveFeeRate = totalFee / totalSize;

  return {
    childFee,
    childFeeRate,
    totalFee,
    totalSize,
    effectiveFeeRate,
  };
}

/**
 * Create a CPFP transaction
 */
export async function createCPFPTransaction(
  parentTxid: string,
  parentVout: number,
  targetFeeRate: number,
  recipientAddress: string,
  walletId: string,
  network: BitcoinNetwork = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  childFee: number;
  childFeeRate: number;
  parentFeeRate: number;
  effectiveFeeRate: number;
  signingContext: PsbtSigningContext;
  feePolicy: SigningIntentFeePolicyV1;
}> {
  // Use nodeClient which respects poolEnabled setting from node_configs
  const client = await getNodeClient(network);

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get parent transaction
  const parentTx = await client.getTransaction(parentTxid);
  const parentVsize = bitcoin.Transaction.fromHex(parentTx.hex).virtualSize();

  // Get the UTXO from parent transaction
  const utxo = await utxoRepository.findByOutpoint(walletId, parentTxid, parentVout);

  if (!utxo) {
    throw new Error('UTXO not found');
  }

  if (utxo.spent) {
    throw new Error('UTXO is already spent');
  }
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) throw new Error('Wallet script identity is unavailable');
  if (!utxo.scriptPubKey) throw new Error('UTXO is missing scriptPubKey evidence');
  const networkObj = getNetwork(network);
  const recipientScript = bitcoin.address.toOutputScript(recipientAddress, networkObj);
  const signingInfo = resolveWalletSigningInfo(wallet, '[CPFP] ');
  const addressPathMap = await fetchAddressDerivationPaths(walletId, [utxo.address]);
  const evidence = resolveTransactionSpendPolicy(
    signingInfo,
    addressPathMap.get(utxo.address) ?? (() => { throw new Error('CPFP input spend evidence is missing'); })(),
    networkObj,
  );

  // Calculate parent fee rate
  let parentInputValue = 0;
  const tx = bitcoin.Transaction.fromHex(parentTx.hex);

  for (const input of tx.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    parentInputValue += Math.round(prevOut.value * 100000000);
  }

  const parentOutputValue = tx.outs.reduce((sum, out) => sum + Number(out.value), 0);
  const parentFee = parentInputValue - parentOutputValue;
  const parentFeeRate = parentFee / parentVsize;

  const childTxSize = estimateTransactionWeight({
    inputs: [{ ...evidence, prevoutScript: Buffer.from(utxo.scriptPubKey, 'hex') }],
    outputs: [{ scriptPubKey: recipientScript }],
  }).vsize;

  // Calculate CPFP fees
  const cpfpCalc = calculateCPFPFee(
    parentVsize,
    parentFeeRate,
    childTxSize,
    targetFeeRate,
    parentFee,
  );
  if (cpfpCalc.childFee <= 0) {
    throw new Error('Target fee rate does not require a positive CPFP child fee');
  }

  // Ensure we have enough value to create the transaction
  const utxoValue = Number(utxo.amount);
  if (cpfpCalc.childFee >= utxoValue) {
    throw new Error(
      `UTXO value (${utxoValue} sats) is insufficient to pay child fee (${cpfpCalc.childFee} sats)`
    );
  }

  const outputValue = utxoValue - cpfpCalc.childFee;
  if (outputValue < dustThreshold) {
    throw new Error(
      `Output would be dust (${outputValue} sats). Minimum is ${dustThreshold} sats.`
    );
  }

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const isLegacy = wallet.scriptType === WalletScriptType.LEGACY;
  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;
  addInputsWithBip32(psbt, [{
    txid: parentTxid,
    vout: parentVout,
    amount: utxo.amount,
    address: utxo.address,
    scriptPubKey: utxo.scriptPubKey,
  }], {
    sequence: 0xffffffff,
    isLegacy,
    rawTxCache: isLegacy
      ? new Map([[parentTxid, Buffer.from(parentTx.hex, 'hex')]])
      : new Map(),
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
    logPrefix: '[CPFP] ',
  });

  psbt.addOutput({
    address: recipientAddress,
    value: BigInt(outputValue),
  });
  const signingContext = await bindPsbtAccount(walletId, psbt);
  if (signingContext.network !== normalizeLegacyBitcoinNetwork(network, 'mainnet')) {
    throw new Error('PSBT account binding failed: CPFP network does not match wallet');
  }

  return {
    psbt,
    childFee: cpfpCalc.childFee,
    childFeeRate: cpfpCalc.childFeeRate,
    parentFeeRate,
    effectiveFeeRate: cpfpCalc.effectiveFeeRate,
    signingContext,
    feePolicy: buildSigningIntentFeePolicy(
      psbt.toBase64(),
      cpfpCalc.childFee / childTxSize,
      cpfpCalc.childFee,
    ),
  };
}

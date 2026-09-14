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
import { addressToOutputScript, getNetwork } from '../utils';
import { getNodeClient } from '../nodeClient';
import type { BitcoinNetwork } from '../networks';
import { normalizeLegacyBitcoinNetwork } from '../networks';
import { draftLockRepository, utxoRepository, walletRepository } from '../../../repositories';
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
import { prepareChangeOutputs } from '../transactions/outputBuilder';
import { estimateTransactionWeight, feeForRate } from '../transactionWeight';
import { buildSigningIntentFeePolicy } from '../signingIntent/feePolicy';
import type { SigningIntentFeePolicyV1 } from '../signingIntent/types';
import { InvalidInputError, NotFoundError } from '../../../errors/ApiError';

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
  // Omitted resolves to the wallet's largest spendable, unspent, unlocked,
  // unfrozen output of parentTxid.
  parentVout: number | undefined,
  targetFeeRate: number,
  // Omitted resolves to a freshly derived change/receive address for the
  // wallet, the same mechanism the batch paths use for change.
  recipientAddress: string | undefined,
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

  // Get the UTXO from parent transaction. When the caller omits an explicit
  // vout, resolve it to the wallet's largest spendable, unspent, unlocked,
  // unfrozen output of parentTxid - the largest output gives the CPFP the
  // most headroom to absorb the child fee without going below the dust
  // threshold. An explicit vout is trusted as-is and is not required to be
  // the largest output of the parent; its spent/frozen/lock state is still
  // checked below.
  const utxo = parentVout !== undefined
    ? await utxoRepository.findByOutpoint(walletId, parentTxid, parentVout)
    : await utxoRepository.findLargestSpendableByTxid(walletId, parentTxid);

  /* v8 ignore next -- both outcomes are tested; v8 misattributes this branch's
     fallthrough hits to the ternary lookup above it rather than to this check */
  if (!utxo) {
    throw new NotFoundError('UTXO not found');
  }
  const resolvedVout = utxo.vout;

  if (utxo.spent) {
    throw new InvalidInputError('UTXO is already spent', 'parentVout');
  }
  if (utxo.frozen) {
    throw new InvalidInputError('UTXO is frozen', 'parentVout');
  }
  const existingDraftLock = await draftLockRepository.findByUtxoId(utxo.id);
  if (existingDraftLock) {
    throw new InvalidInputError('UTXO is locked by a pending draft', 'parentVout');
  }
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) throw new Error('Wallet script identity is unavailable');
  if (!utxo.scriptPubKey) throw new Error('UTXO is missing scriptPubKey evidence');
  const networkObj = getNetwork(network);
  // When the caller omits a recipient address, derive a fresh change/receive
  // address for the wallet — the same mechanism the batch paths use for change.
  const resolvedRecipientAddress = recipientAddress
    ?? (await prepareChangeOutputs(walletId, 1))[0].address;
  const recipientScript = addressToOutputScript(resolvedRecipientAddress, network);
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
    throw new InvalidInputError('Target fee rate does not require a positive CPFP child fee', 'targetFeeRate');
  }

  // Ensure we have enough value to create the transaction
  const utxoValue = Number(utxo.amount);
  if (cpfpCalc.childFee >= utxoValue) {
    throw new InvalidInputError(
      `UTXO value (${utxoValue} sats) is insufficient to pay child fee (${cpfpCalc.childFee} sats)`, 'parentVout'
    );
  }

  const outputValue = utxoValue - cpfpCalc.childFee;
  if (outputValue < dustThreshold) {
    throw new InvalidInputError(
      `Output would be dust (${outputValue} sats). Minimum is ${dustThreshold} sats.`, 'parentVout'
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
    vout: resolvedVout,
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
    script: recipientScript,
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

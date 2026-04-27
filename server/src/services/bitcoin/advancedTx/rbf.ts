/**
 * RBF (Replace-By-Fee) Transaction Support
 *
 * Implements BIP-125 Replace-By-Fee functionality including:
 * - Checking if a transaction signals RBF
 * - Validating transaction replaceability
 * - Creating replacement transactions with higher fees
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, calculateFee } from '../utils';
import { getNodeClient } from '../nodeClient';
import { walletRepository, addressRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { log, RBF_SEQUENCE, MIN_RBF_FEE_BUMP, getDustThreshold } from './shared';
import {
  addInputsWithBip32,
  fetchAddressDerivationPaths,
  parseAccountNode,
  resolveWalletSigningInfo,
} from '../transactions/psbtConstruction';

/**
 * Check if a transaction signals RBF
 */
export function isRBFSignaled(txHex: string): boolean {
  try {
    const tx = bitcoin.Transaction.fromHex(txHex);
    return tx.ins.some(input => input.sequence < 0xfffffffe);
  } catch (error) {
    return false;
  }
}

/**
 * Check if a transaction can be replaced (RBF)
 */
export async function canReplaceTransaction(txid: string): Promise<{
  replaceable: boolean;
  reason?: string;
  currentFeeRate?: number;
  minNewFeeRate?: number;
}> {
  try {
    // Use nodeClient which respects poolEnabled setting from node_configs
    const client = await getNodeClient();

    // Get transaction details
    const txDetails = await client.getTransaction(txid);

    // Check if transaction is confirmed
    if (txDetails.confirmations && txDetails.confirmations > 0) {
      return {
        replaceable: false,
        reason: 'Transaction is already confirmed',
      };
    }

    // Parse transaction to check RBF signal
    const txHex = txDetails.hex;
    if (!txHex) {
      log.warn('Transaction hex not available for RBF check', { txid });
      return {
        replaceable: false,
        reason: 'Transaction data not available from server',
      };
    }

    if (!isRBFSignaled(txHex)) {
      // Log more details for debugging
      try {
        const tx = bitcoin.Transaction.fromHex(txHex);
        const sequences = tx.ins.map(input => input.sequence.toString(16));
        log.debug('RBF check failed', { txid, sequences });
      } catch (e) {
        log.debug('Could not parse tx for sequence logging', { txid });
      }
      return {
        replaceable: false,
        reason: 'Transaction does not signal RBF (BIP-125). All inputs have final sequence numbers.',
      };
    }

    // Calculate current fee rate
    const tx = bitcoin.Transaction.fromHex(txHex);
    const vsize = tx.virtualSize();

    // Get input values to calculate fee
    let inputValue = 0;
    for (const input of tx.ins) {
      const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
      const inputTx = await client.getTransaction(inputTxid);
      const prevOut = inputTx.vout[input.index];
      inputValue += Math.round(prevOut.value * 100000000);
    }

    let outputValue = 0;
    for (const output of tx.outs) {
      outputValue += Number(output.value);
    }

    const currentFee = inputValue - outputValue;
    // Preserve decimal precision for fee rate (2 decimal places)
    const currentFeeRate = parseFloat((currentFee / vsize).toFixed(2));
    // Minimum bump is 1 sat/vB or 10% higher, whichever is greater
    const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
    const minNewFeeRate = parseFloat((currentFeeRate + minBump).toFixed(2));

    return {
      replaceable: true,
      currentFeeRate,
      minNewFeeRate,
    };
  } catch (error) {
    return {
      replaceable: false,
      reason: getErrorMessage(error, 'Failed to check transaction'),
    };
  }
}

/**
 * Create an RBF replacement transaction
 */
export async function createRBFTransaction(
  originalTxid: string,
  newFeeRate: number,
  walletId: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  fee: number;
  feeRate: number;
  feeDelta: number;
  inputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address: string; value: number }>;
  inputPaths: string[];
}> {
  // Use nodeClient which respects poolEnabled setting from node_configs
  const client = await getNodeClient();

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet with devices for fingerprint and xpub
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Check if transaction can be replaced
  const rbfCheck = await canReplaceTransaction(originalTxid);
  if (!rbfCheck.replaceable) {
    throw new Error(rbfCheck.reason || 'Transaction cannot be replaced');
  }

  if (newFeeRate <= (rbfCheck.currentFeeRate || 0)) {
    throw new Error(
      `New fee rate must be higher than current rate (${rbfCheck.currentFeeRate} sat/vB). Minimum: ${rbfCheck.minNewFeeRate} sat/vB`
    );
  }

  // Get original transaction
  const txDetails = await client.getTransaction(originalTxid);
  const tx = bitcoin.Transaction.fromHex(txDetails.hex);
  const networkObj = getNetwork(network);

  // Create new PSBT with same inputs and outputs
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const signingInfo = resolveWalletSigningInfo(wallet, '[RBF] ');

  const rbfInputs = await collectRbfInputs(tx, client, networkObj);
  const accountNode = signingInfo.accountXpub
    ? parseAccountNode(signingInfo.accountXpub, networkObj)
    : undefined;
  const addressPathMap = await fetchAddressDerivationPaths(
    walletId,
    rbfInputs.psbtUtxos.map(utxo => utxo.address).filter(Boolean)
  );
  const inputPaths = addInputsWithBip32(psbt, rbfInputs.psbtUtxos, {
    sequence: RBF_SEQUENCE,
    isLegacy: false,
    rawTxCache: new Map(),
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
    logPrefix: '[RBF] ',
  });

  // Calculate new fee
  const vsize = tx.virtualSize();
  const newFee = calculateFee(vsize, newFeeRate);

  // Get wallet addresses to identify change output
  const walletAddressStrings = await addressRepository.findAddressStrings(walletId);
  const walletAddressSet = new Set(walletAddressStrings);
  const outputs = collectRbfOutputs(tx, networkObj, walletAddressSet);
  const changeOutputIndex = outputs.findIndex(output => output.isChange);

  // Calculate fee difference
  const oldFee = rbfInputs.totalInput - tx.outs.reduce((sum, out) => sum + Number(out.value), 0);
  const feeDelta = newFee - oldFee;

  // Adjust change output to account for fee increase
  adjustChangeOutputForFeeDelta(outputs, changeOutputIndex, feeDelta, dustThreshold);

  // Add adjusted outputs to PSBT
  addRbfOutputs(psbt, outputs);

  return {
    psbt,
    fee: newFee,
    feeRate: newFeeRate,
    feeDelta,
    inputs: rbfInputs.inputs,
    outputs: outputs.map(({ address, value }) => ({ address, value })),
    inputPaths,
  };
}

interface RbfPsbtUtxo {
  txid: string;
  vout: number;
  amount: number;
  address: string;
  scriptPubKey: string;
}

interface RbfInputCollection {
  inputs: Array<{ txid: string; vout: number; value: number }>;
  psbtUtxos: RbfPsbtUtxo[];
  totalInput: number;
}

interface RbfOutput {
  address: string;
  value: number;
  isChange: boolean;
}

async function collectRbfInputs(
  tx: bitcoin.Transaction,
  client: Awaited<ReturnType<typeof getNodeClient>>,
  networkObj: bitcoin.Network
): Promise<RbfInputCollection> {
  const inputs: Array<{ txid: string; vout: number; value: number }> = [];
  const psbtUtxos: RbfPsbtUtxo[] = [];
  let totalInput = 0;

  for (const input of tx.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    const value = Math.round(prevOut.value * 100000000);
    const scriptPubKey = prevOut.scriptPubKey.hex;
    const address = decodeInputAddress(scriptPubKey, networkObj, inputTxid, input.index);

    inputs.push({ txid: inputTxid, vout: input.index, value });
    psbtUtxos.push({
      txid: inputTxid,
      vout: input.index,
      amount: value,
      address: address ?? '',
      scriptPubKey,
    });
    totalInput += value;
  }

  return { inputs, psbtUtxos, totalInput };
}

function decodeInputAddress(
  scriptPubKey: string,
  networkObj: bitcoin.Network,
  txid: string,
  vout: number
): string | undefined {
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptPubKey, 'hex'), networkObj);
  } catch (e) {
    log.warn('Failed to decode input address', { txid, vout });
    return undefined;
  }
}

function collectRbfOutputs(
  tx: bitcoin.Transaction,
  networkObj: bitcoin.Network,
  walletAddressSet: Set<string>
): RbfOutput[] {
  return tx.outs.map(output => {
    const address = bitcoin.address.fromOutputScript(output.script, networkObj);
    return {
      address,
      value: Number(output.value),
      isChange: walletAddressSet.has(address),
    };
  });
}

function adjustChangeOutputForFeeDelta(
  outputs: RbfOutput[],
  changeOutputIndex: number,
  feeDelta: number,
  dustThreshold: number
): void {
  if (feeDelta <= 0) {
    return;
  }

  if (changeOutputIndex < 0) {
    throw new Error('No change output found to deduct additional fee from');
  }

  outputs[changeOutputIndex].value -= feeDelta;
  if (outputs[changeOutputIndex].value < dustThreshold) {
    throw new Error(
      `Insufficient funds in change output to increase fee. Need ${feeDelta} sats more, but change would be dust.`
    );
  }
}

function addRbfOutputs(psbt: bitcoin.Psbt, outputs: RbfOutput[]): void {
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: BigInt(output.value),
    });
  }
}

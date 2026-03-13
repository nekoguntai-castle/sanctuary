/**
 * RBF (Replace-By-Fee) Transaction Support
 *
 * Implements BIP-125 Replace-By-Fee functionality including:
 * - Checking if a transaction signals RBF
 * - Validating transaction replaceability
 * - Creating replacement transactions with higher fees
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { getNetwork, calculateFee } from '../utils';
import { parseDescriptor } from '../addressDerivation';
import { getNodeClient } from '../nodeClient';
import { db as prisma } from '../../../repositories/db';
import { getErrorMessage } from '../../../utils/errors';
import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import { log, RBF_SEQUENCE, MIN_RBF_FEE_BUMP, getDustThreshold } from './shared';

const bip32 = BIP32Factory(ecc);

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
      outputValue += output.value;
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

  // Get master fingerprint and account xpub for bip32Derivation
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;

  if (wallet.devices && wallet.devices.length > 0) {
    const primaryDevice = wallet.devices[0].device;
    if (primaryDevice.fingerprint) {
      masterFingerprint = Buffer.from(primaryDevice.fingerprint, 'hex');
    }
    if (primaryDevice.xpub) {
      accountXpub = primaryDevice.xpub;
    }
  } else if (wallet.fingerprint) {
    masterFingerprint = Buffer.from(wallet.fingerprint, 'hex');
  }

  // Try to get xpub from descriptor if not from device
  if (!accountXpub && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.xpub) {
        accountXpub = parsed.xpub;
      }
    } catch {
      log.debug('Could not parse xpub from descriptor for RBF');
    }
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

  // Get addresses with derivation paths for bip32Derivation
  const addressRecords = await prisma.address.findMany({
    where: { walletId },
    select: {
      address: true,
      derivationPath: true,
    },
  });
  const addressPathMap = new Map(addressRecords.map(a => [a.address, a.derivationPath]));

  // Parse account xpub for deriving public keys
  let accountNode: ReturnType<typeof bip32.fromBase58> | undefined;
  if (accountXpub) {
    try {
      accountNode = bip32.fromBase58(accountXpub, networkObj);
    } catch (e) {
      log.warn('Failed to parse account xpub for RBF', { error: String(e) });
    }
  }

  // Add inputs with RBF sequence
  const inputs: Array<{ txid: string; vout: number; value: number }> = [];
  const inputPaths: string[] = [];
  let totalInput = 0;

  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    const value = Math.round(prevOut.value * 100000000);

    // Get address from scriptPubKey to look up derivation path
    let inputAddress: string | undefined;
    try {
      inputAddress = bitcoin.address.fromOutputScript(
        Buffer.from(prevOut.scriptPubKey.hex, 'hex'),
        networkObj
      );
    } catch (e) {
      log.warn('Failed to decode input address', { txid: inputTxid, vout: input.index });
    }

    const derivationPath = inputAddress ? addressPathMap.get(inputAddress) : undefined;
    inputPaths.push(derivationPath || '');

    psbt.addInput({
      hash: inputTxid,
      index: input.index,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: Buffer.from(prevOut.scriptPubKey.hex, 'hex'),
        value,
      },
    });

    // Add BIP32 derivation info for hardware wallet signing
    if (masterFingerprint && derivationPath && accountNode) {
      try {
        // Parse the derivation path
        const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);

        // Find where the account path ends (after 3 hardened levels)
        let accountPathEnd = 0;
        for (let j = 0; j < pathParts.length && j < 3; j++) {
          if (pathParts[j].endsWith("'") || pathParts[j].endsWith('h')) {
            accountPathEnd = j + 1;
          }
        }

        // Derive from account node using the remaining path (change/index)
        let pubkeyNode = accountNode;
        for (let j = accountPathEnd; j < pathParts.length; j++) {
          const part = pathParts[j];
          const idx = parseInt(part.replace(/['h]/g, ''), 10);
          pubkeyNode = pubkeyNode.derive(idx);
        }

        if (pubkeyNode.publicKey) {
          // Normalize path to apostrophe notation for PSBT compatibility
          const normalizedPath = normalizeDerivationPath(derivationPath);
          psbt.updateInput(i, {
            bip32Derivation: [{
              masterFingerprint,
              path: normalizedPath,
              pubkey: pubkeyNode.publicKey,
            }],
          });
        }
      } catch (e) {
        log.warn('Failed to add bip32Derivation for RBF input', { index: i, error: String(e) });
      }
    }

    inputs.push({
      txid: inputTxid,
      vout: input.index,
      value,
    });

    totalInput += value;
  }

  // Calculate new fee
  const vsize = tx.virtualSize();
  const newFee = calculateFee(vsize, newFeeRate);

  // Add outputs (adjust change output if present)
  const outputs: Array<{ address: string; value: number }> = [];
  let totalOutput = 0;

  // Get wallet addresses to identify change output
  const walletAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });
  const walletAddressSet = new Set(walletAddresses.map(a => a.address));

  let changeOutputIndex = -1;
  for (let i = 0; i < tx.outs.length; i++) {
    const output = tx.outs[i];
    const address = bitcoin.address.fromOutputScript(output.script, networkObj);

    if (walletAddressSet.has(address)) {
      changeOutputIndex = i;
    }

    outputs.push({ address, value: output.value });
  }

  // Calculate fee difference
  const oldFee = totalInput - tx.outs.reduce((sum, out) => sum + out.value, 0);
  const feeDelta = newFee - oldFee;

  // Adjust change output to account for fee increase
  if (changeOutputIndex >= 0 && feeDelta > 0) {
    outputs[changeOutputIndex].value -= feeDelta;

    // Ensure change output is still above dust threshold
    if (outputs[changeOutputIndex].value < dustThreshold) {
      throw new Error(
        `Insufficient funds in change output to increase fee. Need ${feeDelta} sats more, but change would be dust.`
      );
    }
  } else if (feeDelta > 0) {
    throw new Error('No change output found to deduct additional fee from');
  }

  // Add adjusted outputs to PSBT
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
    totalOutput += output.value;
  }

  return {
    psbt,
    fee: newFee,
    feeRate: newFeeRate,
    feeDelta,
    inputs,
    outputs,
    inputPaths,
  };
}

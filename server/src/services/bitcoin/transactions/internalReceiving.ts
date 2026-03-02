/**
 * Internal Receiving Transactions
 *
 * Detects when broadcast transaction outputs belong to other wallets
 * in the app and creates pending "received" transactions for them.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import { createLogger } from '../../../utils/logger';
import { isUniqueConstraintError } from './helpers';
import type { PrismaTxClient } from './types';

const log = createLogger('TX-BROADCAST');

/**
 * Check if any output addresses belong to other wallets in the app.
 * If so, create pending "received" transactions for those wallets immediately.
 */
export async function createInternalReceivingTransactions(
  tx: PrismaTxClient,
  txid: string,
  walletId: string,
  rawTx: string,
  metadata: {
    label?: string;
  }
): Promise<Array<{ walletId: string; amount: number; address: string }>> {
  const createdReceivingTransactions: Array<{ walletId: string; amount: number; address: string }> = [];

  try {
    const txParsed = bitcoin.Transaction.fromHex(rawTx);
    const wallet = await tx.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });
    const networkObj = getNetwork(wallet?.network === 'testnet' ? 'testnet' : 'mainnet');

    // Extract all output addresses
    const outputAddresses: Array<{ address: string; amount: number }> = [];
    for (const output of txParsed.outs) {
      try {
        const addr = bitcoin.address.fromOutputScript(output.script, networkObj);
        outputAddresses.push({ address: addr, amount: output.value });
      } catch (_e) {
        // Skip OP_RETURN or non-standard outputs
      }
    }

    // Find which output addresses belong to OTHER wallets in the app
    const recipientAddresses = await tx.address.findMany({
      where: {
        address: { in: outputAddresses.map(o => o.address) },
        walletId: { not: walletId },
      },
      select: {
        walletId: true,
        address: true,
      },
    });

    // Group outputs by receiving wallet
    const walletOutputs = new Map<string, { address: string; amount: number }[]>();
    for (const addrRecord of recipientAddresses) {
      const outputs = outputAddresses.filter(o => o.address === addrRecord.address);
      const existing = walletOutputs.get(addrRecord.walletId) || [];
      walletOutputs.set(addrRecord.walletId, [...existing, ...outputs]);
    }

    // Create pending received transaction for each receiving wallet
    for (const [receivingWalletId, outputs] of walletOutputs) {
      const totalAmount = outputs.reduce((sum, o) => sum + o.amount, 0);

      log.info('Creating pending received transaction for internal wallet', {
        txid,
        sendingWalletId: walletId,
        receivingWalletId,
        outputCount: outputs.length,
        totalAmount,
      });

      // Check if transaction already exists for receiving wallet (avoid duplicates)
      const existingReceivedTx = await tx.transaction.findFirst({
        where: {
          txid,
          walletId: receivingWalletId,
        },
      });

      if (existingReceivedTx) {
        continue;
      }

      try {
        await tx.transaction.create({
          data: {
            txid,
            walletId: receivingWalletId,
            type: 'received',
            amount: BigInt(totalAmount),
            fee: BigInt(0),
            confirmations: 0,
            label: metadata.label,
            blockHeight: null,
            blockTime: null,
            rawTx,
            counterpartyAddress: null,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        log.debug('Skipping duplicate pending receive record', {
          txid,
          receivingWalletId,
        });
        continue;
      }

      createdReceivingTransactions.push({
        walletId: receivingWalletId,
        amount: totalAmount,
        address: outputs[0]?.address || '',
      });
    }
  } catch (e) {
    log.warn('Failed to create pending transactions for receiving wallets', { error: String(e) });
  }

  return createdReceivingTransactions;
}

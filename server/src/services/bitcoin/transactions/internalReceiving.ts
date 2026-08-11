/**
 * Detect and persist pending receives for outputs owned by other Sanctuary wallets.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import { normalizeLegacyBitcoinNetwork } from '../networks';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { PrismaTxClient } from './types';

const log = createLogger('BITCOIN:SVC_TX_INTERNAL');

interface ParsedOutput {
  outputIndex: number;
  address: string;
  amount: number;
  scriptPubKey: string;
}

export interface InternalReceivingOutcome {
  status: 'created' | 'existing';
  walletId: string;
  amount: number;
  address: string;
}

const parseAddressOutputs = (
  rawTx: string,
  network: bitcoin.Network
): ParsedOutput[] => {
  const parsed = bitcoin.Transaction.fromHex(rawTx);
  return parsed.outs.flatMap((output, outputIndex) => {
    try {
      return [{
        outputIndex,
        address: bitcoin.address.fromOutputScript(output.script, network),
        amount: Number(output.value),
        scriptPubKey: Buffer.from(output.script).toString('hex'),
      }];
    } catch (error) {
      log.debug('Skipping non-address output while detecting internal receive', {
        outputIndex,
        error: getErrorMessage(error),
      });
      return [];
    }
  });
};

const groupOutputsByWallet = (
  outputs: ParsedOutput[],
  owners: Array<{ walletId: string; address: string }>
): Map<string, ParsedOutput[]> => {
  const outputsByAddress = new Map<string, ParsedOutput[]>();
  for (const output of outputs) {
    const matches = outputsByAddress.get(output.address) ?? [];
    matches.push(output);
    outputsByAddress.set(output.address, matches);
  }

  const outputsByWallet = new Map<string, ParsedOutput[]>();
  for (const owner of owners) {
    /* v8 ignore next -- owners are queried from the exact parsed output-address set */
    const matches = outputsByAddress.get(owner.address) ?? [];
    /* v8 ignore next -- repository owners are selected from the exact parsed output-address set */
    if (matches.length === 0) continue;
    const walletOutputs = outputsByWallet.get(owner.walletId) ?? [];
    walletOutputs.push(...matches);
    outputsByWallet.set(owner.walletId, walletOutputs);
  }
  return outputsByWallet;
};

const persistReceivingTransaction = async (
  tx: PrismaTxClient,
  txid: string,
  walletId: string,
  rawTx: string,
  outputs: ParsedOutput[]
): Promise<InternalReceivingOutcome> => {
  const amount = outputs.reduce((sum, output) => sum + output.amount, 0);
  const inserted = await tx.transaction.createManyAndReturn({
    data: [{
      txid,
      walletId,
      type: 'received',
      amount: BigInt(amount),
      fee: BigInt(0),
      confirmations: 0,
      blockHeight: null,
      blockTime: null,
      rawTx,
      counterpartyAddress: null,
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  const status = inserted.length > 0 ? 'created' : 'existing';
  const transaction = inserted[0] ?? await tx.transaction.findUnique({
    where: { txid_walletId: { txid, walletId } },
    select: { id: true },
  });
  if (!transaction) {
    throw new Error(`Unable to resolve internal receiving transaction ${txid} for wallet ${walletId}`);
  }

  await tx.transactionOutput.createMany({
    data: outputs.map(output => ({
      transactionId: transaction.id,
      outputIndex: output.outputIndex,
      address: output.address,
      amount: BigInt(output.amount),
      outputType: 'recipient',
      isOurs: true,
      scriptPubKey: output.scriptPubKey,
    })),
    skipDuplicates: true,
  });

  log.info('Resolved pending receive transaction for internal wallet', {
    txid,
    receivingWalletId: walletId,
    status,
    outputCount: outputs.length,
    amount,
  });
  return { status, walletId, amount, address: outputs[0].address };
};

export async function createInternalReceivingTransactions(
  tx: PrismaTxClient,
  txid: string,
  sendingWalletId: string,
  rawTx: string
): Promise<InternalReceivingOutcome[]> {
  const wallet = await tx.wallet.findUnique({
    where: { id: sendingWalletId },
    select: { network: true },
  });
  if (!wallet) {
    throw new Error(`Sending wallet ${sendingWalletId} was not found during transaction persistence`);
  }

  const network = getNetwork(normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet'));
  const outputs = parseAddressOutputs(rawTx, network);
  if (outputs.length === 0) return [];

  const owners = await tx.address.findMany({
    where: {
      address: { in: outputs.map(output => output.address) },
      walletId: { not: sendingWalletId },
      wallet: { network: wallet.network },
    },
    select: { walletId: true, address: true },
  });
  const outputsByWallet = groupOutputsByWallet(outputs, owners);
  const outcomes: InternalReceivingOutcome[] = [];
  for (const [walletId, walletOutputs] of outputsByWallet) {
    outcomes.push(await persistReceivingTransaction(tx, txid, walletId, rawTx, walletOutputs));
  }
  return outcomes;
}

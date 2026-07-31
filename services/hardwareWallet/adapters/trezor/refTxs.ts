/**
 * Reference Transactions
 *
 * Fetches raw transactions from the server for Trezor signing verification.
 */

import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../../../../src/api/client';
import { createLogger } from '../../../../utils/logger';
import { toHex } from '../../../../utils/bufferUtils';

const log = createLogger('TrezorAdapter');

/**
 * Fetch reference transactions needed for Trezor signing
 */
export async function fetchRefTxs(psbt: bitcoin.Psbt, walletId: string): Promise<any[]> {
  const refTxs: any[] = [];
  const seenTxids = new Set<string>();

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const txInput = psbt.txInputs[i];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');

    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);

    try {
      const response = await apiClient.get<{ hex: string }>(
        `/wallets/${encodeURIComponent(walletId)}/transactions/${txid}/raw`
      );
      const rawTx = bitcoin.Transaction.fromHex(response.hex);

      const refTx = {
        hash: txid,
        version: rawTx.version,
        lock_time: rawTx.locktime,
        inputs: rawTx.ins.map(txIn => ({
          prev_hash: toHex(Buffer.from(txIn.hash).reverse()),
          prev_index: txIn.index,
          script_sig: toHex(txIn.script),
          sequence: txIn.sequence,
        })),
        bin_outputs: rawTx.outs.map(output => ({
          amount: output.value,
          script_pubkey: toHex(output.script),
        })),
      };

      refTxs.push(refTx);
    } catch (error) {
      log.warn('Failed to fetch reference transaction', { txid, error });
    }
  }

  return refTxs;
}

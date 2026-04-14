/**
 * PSBT Info Module
 *
 * Utilities for parsing and extracting information from PSBTs.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../utils/logger';

const log = createLogger('BITCOIN:SVC_PSBT_INFO');

/**
 * PSBT input information
 */
export interface PSBTInputInfo {
  txid: string;
  vout: number;
  value: number;
}

/**
 * PSBT output information
 */
export interface PSBTOutputInfo {
  address?: string;
  value: number;
  isChange: boolean;
}

/**
 * Complete PSBT information
 */
export interface PSBTInfo {
  inputs: PSBTInputInfo[];
  outputs: PSBTOutputInfo[];
  fee: number;
}

/**
 * Get transaction info from PSBT for hardware wallet display
 *
 * @param psbtBase64 - Base64-encoded PSBT
 * @returns Parsed PSBT information including inputs, outputs, and fee
 */
export function getPSBTInfo(psbtBase64: string): PSBTInfo {
  return getPSBTInfoWithNetwork(psbtBase64, 'mainnet');
}

/**
 * Get PSBT info with network-aware address parsing
 *
 * @param psbtBase64 - Base64-encoded PSBT
 * @param network - Bitcoin network ('mainnet' or 'testnet')
 * @returns Parsed PSBT information
 */
export function getPSBTInfoWithNetwork(psbtBase64: string, network: 'mainnet' | 'testnet'): PSBTInfo {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
  const networkObj = network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

  const inputs = psbt.data.inputs.map((input, index) => {
    const txInput = psbt.txInputs[index];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const vout = txInput.index;
    const value = Number(input.witnessUtxo?.value ?? 0);

    return { txid, vout, value };
  });

  const outputs = psbt.txOutputs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(output.script, networkObj);
    } catch (error) {
      log.debug('PSBT output has no standard address', { error: String(error) });
      // OP_RETURN and other non-address outputs are expected
    }

    return {
      address,
      value: Number(output.value),
      isChange: false,
    };
  });

  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutput = outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = totalInput - totalOutput;

  return {
    inputs,
    outputs,
    fee,
  };
}

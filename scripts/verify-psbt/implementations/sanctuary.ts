/**
 * Sanctuary PSBT Implementation Wrapper
 *
 * Wraps our bitcoinjs-lib based PSBT implementation for cross-verification.
 * This allows us to compare our output against Bitcoin Core and other implementations.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { Network, PsbtImplementation, PsbtInput, PsbtOutput, PsbtValidationResult } from '../types';

/**
 * Get bitcoinjs-lib network from our network type
 */
function getNetwork(network: Network): bitcoin.Network {
  switch (network) {
    case 'mainnet':
      return bitcoin.networks.bitcoin;
    case 'testnet':
    case 'regtest':
      return bitcoin.networks.testnet;
    default:
      return bitcoin.networks.testnet;
  }
}

/**
 * Parse the unsigned transaction from a PSBT across bitcoinjs versions.
 */
function getUnsignedTransaction(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const rawUnsignedTx = psbt.data.getTransaction();
  return bitcoin.Transaction.fromBuffer(Buffer.from(rawUnsignedTx));
}

/**
 * Sanctuary (bitcoinjs-lib) PSBT Implementation
 */
export class SanctuaryImplementation implements PsbtImplementation {
  name = 'Sanctuary (bitcoinjs-lib)';
  version: string;

  constructor() {
    // Get bitcoinjs-lib version from package.json if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('bitcoinjs-lib/package.json');
      this.version = pkg.version || 'unknown';
    } catch {
      this.version = 'unknown';
    }
  }

  /**
   * Decode a PSBT and return its structure
   */
  async decodePsbt(psbtBase64: string): Promise<Record<string, unknown>> {
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

    return {
      tx: {
        txid: getUnsignedTransaction(psbt).getId(),
        version: psbt.version,
        locktime: psbt.locktime,
        vin: psbt.txInputs.map((input, index) => ({
          txid: Buffer.from(input.hash).reverse().toString('hex'),
          vout: input.index,
          sequence: input.sequence,
          psbt_index: index,
        })),
        vout: psbt.txOutputs.map((output, index) => ({
          value: output.value,
          n: index,
          scriptPubKey: {
            hex: Buffer.from(output.script).toString('hex'),
          },
        })),
      },
      inputs: psbt.data.inputs.map((input, index) => ({
        index,
        has_utxo: !!(input.witnessUtxo || input.nonWitnessUtxo),
        witnessUtxo: input.witnessUtxo
          ? {
              amount: input.witnessUtxo.value,
              scriptPubKey: Buffer.from(input.witnessUtxo.script).toString('hex'),
            }
          : undefined,
        redeemScript: input.redeemScript ? Buffer.from(input.redeemScript).toString('hex') : undefined,
        witnessScript: input.witnessScript ? Buffer.from(input.witnessScript).toString('hex') : undefined,
        bip32Derivation: input.bip32Derivation?.map((d) => ({
          pubkey: Buffer.from(d.pubkey).toString('hex'),
          masterFingerprint: Buffer.from(d.masterFingerprint).toString('hex'),
          path: d.path,
        })),
        partialSig: input.partialSig?.map((s) => ({
          pubkey: Buffer.from(s.pubkey).toString('hex'),
          signature: Buffer.from(s.signature).toString('hex'),
        })),
        sighashType: input.sighashType,
        finalScriptSig: input.finalScriptSig ? Buffer.from(input.finalScriptSig).toString('hex') : undefined,
        finalScriptWitness: input.finalScriptWitness ? Buffer.from(input.finalScriptWitness).toString('hex') : undefined,
      })),
      outputs: psbt.data.outputs.map((output, index) => ({
        index,
        redeemScript: output.redeemScript ? Buffer.from(output.redeemScript).toString('hex') : undefined,
        witnessScript: output.witnessScript ? Buffer.from(output.witnessScript).toString('hex') : undefined,
        bip32Derivation: output.bip32Derivation?.map((d) => ({
          pubkey: Buffer.from(d.pubkey).toString('hex'),
          masterFingerprint: Buffer.from(d.masterFingerprint).toString('hex'),
          path: d.path,
        })),
      })),
    };
  }

  /**
   * Validate a PSBT and return decoded information
   */
  async validatePsbt(psbtBase64: string): Promise<PsbtValidationResult> {
    try {
      const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

      // Calculate fee
      let inputValue = BigInt(0);
      let outputValue = BigInt(0);
      let complete = true;

      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          inputValue += input.witnessUtxo.value;
        } else if (input.nonWitnessUtxo) {
          // Would need to parse the full tx to get the value
          // For now, we can't calculate fee without witnessUtxo
        } else {
          complete = false;
        }

        // Check if input is finalized
        if (!input.finalScriptSig && !input.finalScriptWitness) {
          // Not finalized - check for partial signatures
          if (!input.partialSig || input.partialSig.length === 0) {
            complete = false;
          }
        }
      });

      psbt.txOutputs.forEach((output) => {
        outputValue += output.value;
      });

      const fee = inputValue > BigInt(0) ? Number(inputValue - outputValue) : 0;

      return {
        valid: true,
        decoded: {
          txid: getUnsignedTransaction(psbt).getId(),
          inputs: psbt.data.inputs.length,
          outputs: psbt.data.outputs.length,
          fee,
          vsize: estimateVsize(psbt),
          complete,
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create an unsigned PSBT from inputs and outputs
   */
  async createPsbt(params: {
    inputs: PsbtInput[];
    outputs: PsbtOutput[];
    network: Network;
  }): Promise<string> {
    const { inputs, outputs, network } = params;
    const btcNetwork = getNetwork(network);

    const psbt = new bitcoin.Psbt({ network: btcNetwork });

    // Add inputs
    for (const input of inputs) {
      const inputData: {
        hash: string;
        index: number;
        sequence?: number;
        witnessUtxo?: { script: Buffer; value: number };
        nonWitnessUtxo?: Buffer;
        redeemScript?: Buffer;
        witnessScript?: Buffer;
      } = {
        hash: input.txid,
        index: input.vout,
        sequence: 0xfffffffd, // RBF enabled by default
      };

      // Add witnessUtxo if provided
      if (input.witnessUtxo) {
        inputData.witnessUtxo = {
          script: Buffer.from(input.witnessUtxo.script, 'hex'),
          value: BigInt(input.witnessUtxo.value),
        };
      }

      // Add nonWitnessUtxo if provided
      if (input.nonWitnessUtxo) {
        inputData.nonWitnessUtxo = Buffer.from(input.nonWitnessUtxo, 'hex');
      }

      // Add redeemScript if provided
      if (input.redeemScript) {
        inputData.redeemScript = Buffer.from(input.redeemScript, 'hex');
      }

      // Add witnessScript if provided
      if (input.witnessScript) {
        inputData.witnessScript = Buffer.from(input.witnessScript, 'hex');
      }

      psbt.addInput(inputData);
    }

    // Add outputs
    for (const output of outputs) {
      psbt.addOutput({
        address: output.address,
        value: BigInt(output.amount),
      });
    }

    return psbt.toBase64();
  }

  /**
   * Finalize a fully-signed PSBT and return the raw transaction hex
   */
  async finalizePsbt(psbtBase64: string): Promise<string> {
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }

  /**
   * Combine multiple PSBTs
   */
  async combinePsbt(psbts: string[]): Promise<string> {
    if (psbts.length === 0) {
      throw new Error('At least one PSBT required');
    }

    const basePsbt = bitcoin.Psbt.fromBase64(psbts[0]);

    for (let i = 1; i < psbts.length; i++) {
      const otherPsbt = bitcoin.Psbt.fromBase64(psbts[i]);
      basePsbt.combine(otherPsbt);
    }

    return basePsbt.toBase64();
  }
}

/**
 * Estimate virtual size of a PSBT
 * This is a rough estimate based on the transaction structure
 */
function estimateVsize(psbt: bitcoin.Psbt): number {
  // Get the base transaction size
  const tx = getUnsignedTransaction(psbt);
  const baseSize = tx.byteLength();

  // Estimate witness size based on input types
  let witnessSize = 0;
  psbt.data.inputs.forEach((input) => {
    if (input.witnessUtxo) {
      // SegWit input
      if (input.witnessScript) {
        // P2WSH - estimate based on multisig
        witnessSize += 150; // Rough estimate for 2-of-3 multisig
      } else if (input.redeemScript) {
        // P2SH-P2WPKH or P2SH-P2WSH
        witnessSize += 110;
      } else {
        // P2WPKH
        witnessSize += 107;
      }
    }
  });

  // Virtual size formula for SegWit: base_size + witness_size / 4
  return Math.ceil(baseSize + witnessSize / 4);
}

export default SanctuaryImplementation;

/**
 * Go (btcd/btcutil) Implementation Wrapper
 *
 * Calls the Go script for address derivation using btcd/btcutil libraries.
 * This provides a completely independent implementation used by Lightning Network.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GO_SCRIPT = join(__dirname, 'go-verify.go');

interface GoResult {
  address?: string;
  error?: string;
  available?: boolean;
  version?: string;
  name?: string;
}

async function runGo(args: string[]): Promise<GoResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('go', ['run', GO_SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // go.mod sits beside go-verify.go, not at the repo root. Without an
      // explicit cwd this inherits the caller's directory (verify-addresses/),
      // where Go finds no module, cannot resolve btcd, and exits non-zero. The
      // generator reads that as "btcd/btcutil UNAVAILABLE", drops Go from the
      // panel, and still prints "All vectors verified successfully" -- five-way
      // agreement silently degraded to four-way.
      cwd: __dirname,
      env: {
        ...process.env,
        // Ensure Go modules work
        GO111MODULE: 'on',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Go not found or failed to run: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0 && stdout === '') {
        reject(new Error(`Go script failed: ${stderr || 'Unknown error'}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as GoResult;
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      } catch (e) {
        reject(new Error(`Failed to parse Go output: ${stdout}`));
      }
    });
  });
}

export const goImpl: AddressDeriver = {
  name: 'btcd/btcutil (Go)',
  version: '0.24.2',

  async deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const result = await runGo([
      'single',
      xpub,
      String(index),
      scriptType,
      String(change),
      network,
    ]);

    if (!result.address) {
      throw new Error('No address returned from Go script');
    }

    return result.address;
  },

  async deriveMultisig(
    xpubs: string[],
    threshold: number,
    index: number,
    scriptType: MultisigScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const result = await runGo([
      'multi',
      JSON.stringify(xpubs),
      String(threshold),
      String(index),
      scriptType,
      String(change),
      network,
    ]);

    if (!result.address) {
      throw new Error('No address returned from Go script');
    }

    return result.address;
  },

  async isAvailable(): Promise<boolean> {
    try {
      const result = await runGo(['check']);
      if (result.available && result.version) {
        this.version = result.version;
      }
      return result.available === true;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      return false;
    }
  },
};

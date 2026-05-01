/**
 * Python (bip_utils) Implementation Wrapper
 *
 * Calls the Python script for address derivation using bip_utils library.
 * This provides a completely independent implementation in a different language.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_SCRIPT = join(__dirname, 'python-verify.py');

interface PythonResult {
  address?: string;
  error?: string;
  available?: boolean;
  version?: string;
  name?: string;
}

async function runPython(args: string[]): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    // Prefer the repeatable verification venv when the wrapper provides it.
    const configuredPython = process.env.VERIFY_ADDRESSES_PYTHON;
    const pythonCommands = configuredPython ? [configuredPython] : ['python3', 'python'];
    let tried = 0;

    function tryCommand(cmd: string) {
      const proc = spawn(cmd, [PYTHON_SCRIPT, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
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
        tried++;
        if (tried < pythonCommands.length) {
          tryCommand(pythonCommands[tried]);
        } else {
          reject(new Error(`Python not found: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        if (code !== 0 && stdout === '') {
          reject(new Error(`Python script failed: ${stderr || 'Unknown error'}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim()) as PythonResult;
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });
    }

    tryCommand(pythonCommands[0]);
  });
}

export const pythonImpl: AddressDeriver = {
  name: 'bip_utils (Python)',
  version: '1.13.0',

  async deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const result = await runPython([
      'single',
      xpub,
      String(index),
      scriptType,
      String(change),
      network,
    ]);

    if (!result.address) {
      throw new Error('No address returned from Python script');
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
    const result = await runPython([
      'multi',
      JSON.stringify(xpubs),
      String(threshold),
      String(index),
      scriptType,
      String(change),
      network,
    ]);

    if (!result.address) {
      throw new Error('No address returned from Python script');
    }

    return result.address;
  },

  async isAvailable(): Promise<boolean> {
    try {
      const result = await runPython(['check']);
      if (result.available && result.version) {
        this.version = result.version;
      }
      return result.available === true;
    } catch {
      return false;
    }
  },
};

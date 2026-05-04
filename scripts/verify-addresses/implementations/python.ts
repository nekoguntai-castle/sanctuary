/**
 * Python (bip_utils) Implementation Wrapper
 *
 * Calls the Python script for address derivation using bip_utils library.
 * This provides a completely independent implementation in a different language.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_SCRIPT = join(__dirname, 'python-verify.py');
const DEFAULT_PYTHON_RUN_ATTEMPTS = 3;

interface PythonResult {
  address?: string;
  error?: string;
  available?: boolean;
  version?: string;
  name?: string;
}

interface PythonProcessOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

function getPythonRunAttempts(): number {
  const rawAttempts = process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS;
  if (!rawAttempts) {
    return DEFAULT_PYTHON_RUN_ATTEMPTS;
  }

  const parsed = Number(rawAttempts);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS must be a positive integer');
  }

  return parsed;
}

function configuredPythonCommands(): string[] {
  const configuredPython = process.env.VERIFY_ADDRESSES_PYTHON;
  return configuredPython ? [configuredPython] : ['python3', 'python'];
}

function runPythonProcess(command: string, args: string[]): Promise<PythonProcessOutcome> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [PYTHON_SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    proc.on('close', (code, signal) => {
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, code, signal });
      }
    });
  });
}

function parsePythonResult(stdout: string): PythonResult {
  try {
    const result = JSON.parse(stdout.trim()) as PythonResult;
    if (result.error) {
      throw new Error(result.error);
    }
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Python output: ${stdout}`);
    }
    throw error;
  }
}

function pythonFailureMessage(outcome: PythonProcessOutcome): string {
  const status = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code ?? 'unknown'}`;
  const detail = outcome.stderr.trim() || 'no stderr';
  return `Python script failed (${status}): ${detail}`;
}

function isEmptyProcessFailure(outcome: PythonProcessOutcome): boolean {
  return outcome.code !== 0 && outcome.stdout.trim() === '';
}

async function runPythonCommand(command: string, args: string[]): Promise<PythonResult> {
  const attempts = getPythonRunAttempts();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const outcome = await runPythonProcess(command, args);
    if (isEmptyProcessFailure(outcome)) {
      lastError = new Error(pythonFailureMessage(outcome));
      continue;
    }

    return parsePythonResult(outcome.stdout);
  }

  throw lastError ?? new Error('Python script failed before producing output');
}

async function runPython(args: string[]): Promise<PythonResult> {
  let lastError: Error | null = null;

  for (const command of configuredPythonCommands()) {
    try {
      return await runPythonCommand(command, args);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Python not found: ${lastError?.message ?? 'no candidate command worked'}`);
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

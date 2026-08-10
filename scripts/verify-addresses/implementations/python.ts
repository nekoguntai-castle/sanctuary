/** Batch wrapper for the independent bip_utils seed-to-address verifier. */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DerivationEvidence,
  DerivationImplementation,
  DerivationTestCase,
  TestSeed,
} from '../types.js';
import { PINNED_PYTHON_EFFECTIVE_UID } from '../standardsOracle.js';

const PYTHON_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'python-verify.py');
const DEFAULT_ATTEMPTS = 3;

interface PythonResponse {
  available?: boolean;
  version?: string;
  pythonVersion?: string;
  effectiveUid?: number;
  dependencyFingerprint?: string;
  sourceSha256?: string;
  error?: string;
  evidence?: DerivationEvidence[];
}

interface PythonProvenance {
  readonly pythonVersion: string;
  readonly effectiveUid: number;
  readonly dependencyFingerprint: string;
  readonly sourceSha256: string;
}

let runtimeProvenance: PythonProvenance | undefined;

export function getPythonProvenance(): PythonProvenance {
  if (!runtimeProvenance) throw new Error('Python verifier runtime was not inspected');
  return runtimeProvenance;
}

class PythonCalculationError extends Error {}

interface PythonInvocation { readonly command: string; readonly prefixArgs: readonly string[] }

function pythonCommands(): PythonInvocation[] {
  const configured = process.env.VERIFY_ADDRESSES_PYTHON;
  if (configured) {
    if (configured.trim() !== configured || /[\0\r\n\t ]/.test(configured)) {
      throw new Error('VERIFY_ADDRESSES_PYTHON must be a single executable path or command name');
    }
    return [{ command: configured, prefixArgs: [PYTHON_SCRIPT] }];
  }
  const imageId = process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID;
  // Tags can be retargeted between build and execution; the launcher supplies
  // Docker's content-addressed ID captured atomically by `docker build`.
  if (!imageId || !/^sha256:[0-9a-f]{64}$/.test(imageId)) {
    throw new Error('VERIFY_ADDRESSES_PYTHON_IMAGE_ID must be an immutable sha256 image ID');
  }
  // The independent verifier runs offline and is removed after every invocation.
  return [{ command: 'docker', prefixArgs: ['run', '--rm', '--network', 'none', '-i', imageId] }];
}

function runAttempts(): number {
  const raw = process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS;
  if (!raw) return DEFAULT_ATTEMPTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS must be a positive integer');
  }
  return parsed;
}

function invoke(invocation: PythonInvocation, action: 'check' | 'batch', input?: unknown): Promise<PythonResponse> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- fixed script; shell disabled; configured executable validated.
    const child = spawn(invocation.command, [...invocation.prefixArgs, action], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error);
    });
    child.on('close', (code, signal) => {
      if (code !== 0 && stdout.trim() === '') {
        reject(new Error(`Python verifier failed (${signal ?? `exit ${code}`}): ${stderr.trim() || 'no stderr'}`));
        return;
      }
      try {
        const response = JSON.parse(stdout.trim()) as PythonResponse;
        if (response.error) reject(new PythonCalculationError(response.error));
        else resolve(response);
      } catch (error) {
        reject(error instanceof SyntaxError
          ? new Error(`Failed to parse Python verifier output: ${stdout}`)
          : error);
      }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

async function run(action: 'check' | 'batch', input?: unknown): Promise<PythonResponse> {
  let lastError: unknown;
  for (const invocation of pythonCommands()) {
    for (let attempt = 0; attempt < runAttempts(); attempt += 1) {
      try {
        return await invoke(invocation, action, input);
      } catch (error) {
        lastError = error;
        if (error instanceof PythonCalculationError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No Python interpreter succeeded');
}

export const pythonImpl: DerivationImplementation = {
  id: 'bip-utils-python',
  name: 'bip_utils (Python)',
  version: '2.12.1',

  async isAvailable(): Promise<boolean> {
    try {
      const response = await run('check');
      if (response.version) this.version = response.version;
      if (response.available === true
        && (!response.pythonVersion || !response.dependencyFingerprint || !response.sourceSha256
          || response.effectiveUid !== PINNED_PYTHON_EFFECTIVE_UID)) {
        throw new Error('Python verifier omitted required runtime provenance');
      }
      if (response.pythonVersion && response.dependencyFingerprint && response.sourceSha256
        && response.effectiveUid === PINNED_PYTHON_EFFECTIVE_UID) {
        runtimeProvenance = {
          pythonVersion: response.pythonVersion,
          effectiveUid: response.effectiveUid,
          dependencyFingerprint: response.dependencyFingerprint,
          sourceSha256: response.sourceSha256,
        };
      }
      return response.available === true;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      return false;
    }
  },

  async deriveCases(
    cases: readonly DerivationTestCase[],
    seeds: readonly TestSeed[],
  ): Promise<DerivationEvidence[]> {
    const response = await run('batch', { cases, seeds });
    if (!response.evidence || response.evidence.length !== cases.length) {
      throw new Error(`Python verifier returned ${response.evidence?.length ?? 0}/${cases.length} cases`);
    }
    return response.evidence;
  },
};

/** Batch wrapper for the independent btcd/go-bip39 seed-to-address verifier. */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DerivationEvidence,
  DerivationImplementation,
  DerivationTestCase,
  TestSeed,
} from '../types.js';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const GO_SCRIPT = join(DIRECTORY, 'go-verify.go');

interface GoResponse {
  available?: boolean;
  version?: string;
  runtimeVersion?: string;
  error?: string;
  evidence?: DerivationEvidence[];
}

let runtimeVersion: string | undefined;

export function getGoRuntimeVersion(): string {
  if (!runtimeVersion) throw new Error('Go verifier runtime was not inspected');
  return runtimeVersion;
}

function runGo(action: 'check' | 'batch', input?: unknown): Promise<GoResponse> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- fixed executable/script; shell disabled.
    const child = spawn('go', ['run', GO_SCRIPT, action], {
      cwd: DIRECTORY,
      env: { ...process.env, GO111MODULE: 'on' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', error => reject(new Error(`Go verifier could not start: ${error.message}`)));
    child.on('close', code => {
      if (code !== 0 && stdout.trim() === '') {
        reject(new Error(`Go verifier failed (exit ${code}): ${stderr.trim() || 'no stderr'}`));
        return;
      }
      try {
        const response = JSON.parse(stdout.trim()) as GoResponse;
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      } catch (error) {
        reject(error instanceof SyntaxError
          ? new Error(`Failed to parse Go verifier output: ${stdout}`)
          : error);
      }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

export const goImpl: DerivationImplementation = {
  id: 'btcd-go',
  name: 'btcd/btcutil (Go)',
  version: '0.25.0 + go-bip39 1.1.0',

  async isAvailable(): Promise<boolean> {
    try {
      const response = await runGo('check');
      if (response.version) this.version = response.version;
      runtimeVersion = response.runtimeVersion;
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
    const response = await runGo('batch', { cases, seeds });
    if (!response.evidence || response.evidence.length !== cases.length) {
      throw new Error(`Go verifier returned ${response.evidence?.length ?? 0}/${cases.length} cases`);
    }
    return response.evidence;
  },
};

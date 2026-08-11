/**
 * Bitcoin Core PSBT Verification Wrapper
 *
 * This module provides an interface to Bitcoin Core for cross-verification
 * of PSBTs. It uses the bitcoin-cli RPC interface to:
 * - Decode and validate PSBTs
 * - Analyze PSBT fee and structure
 * - Verify our PSBT generation matches Bitcoin Core's expectations
 *
 * Requirements:
 * - Bitcoin Core running with RPC enabled (testnet/regtest recommended)
 * - bitcoin-cli accessible in PATH, OR
 * - Direct RPC connection configuration
 */

import { spawn } from 'child_process';
import type { Network, PsbtImplementation, PsbtValidationResult } from '../types';

export interface BitcoinCoreConfig {
  /**
   * RPC connection mode:
   * - 'cli': Use bitcoin-cli command (default)
   * - 'rpc': Direct JSON-RPC connection
   */
  mode: 'cli' | 'rpc';

  /**
   * Network to use
   */
  network: Network;

  /**
   * Path to bitcoin-cli (if mode is 'cli')
   */
  cliPath?: string;

  /**
   * RPC configuration (if mode is 'rpc')
   */
  rpc?: {
    host: string;
    port: number;
    user: string;
    password: string;
  };

  /**
   * Data directory for Bitcoin Core
   */
  datadir?: string;

  /**
   * Timeout in milliseconds for RPC calls
   */
  timeout?: number;
}

const DEFAULT_CONFIG: BitcoinCoreConfig = {
  mode: 'cli',
  network: 'regtest',
  cliPath: 'bitcoin-cli',
  timeout: 30000,
};

/**
 * Execute a Bitcoin Core RPC command via bitcoin-cli
 */
async function execBitcoinCli(
  command: string,
  args: string[],
  config: BitcoinCoreConfig
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = config.cliPath || 'bitcoin-cli';
    const cliArgs: string[] = [];

    // Add network flag
    if (config.network === 'testnet') {
      cliArgs.push('-testnet');
    } else if (config.network === 'regtest') {
      cliArgs.push('-regtest');
    }

    // Add datadir if specified
    if (config.datadir) {
      cliArgs.push(`-datadir=${config.datadir}`);
    }

    // Add command and arguments
    cliArgs.push(command, ...args);

    const process = spawn(cliPath, cliArgs);
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error(`Bitcoin Core CLI timeout after ${config.timeout}ms`));
    }, config.timeout || 30000);

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Bitcoin Core CLI error (code ${code}): ${stderr || stdout}`));
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to execute bitcoin-cli: ${err.message}`));
    });
  });
}

/**
 * Execute a Bitcoin Core RPC command via direct JSON-RPC
 */
async function execRpcDirect(
  method: string,
  params: unknown[],
  config: BitcoinCoreConfig
): Promise<unknown> {
  if (!config.rpc) {
    throw new Error('RPC configuration required for direct RPC mode');
  }

  const { host, port, user, password } = config.rpc;
  const url = `http://${host}:${port}`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: Date.now(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(config.timeout || 30000),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }

  return result.result;
}

/**
 * Execute an RPC command using the configured mode
 */
async function execRpc(
  method: string,
  params: unknown[],
  config: BitcoinCoreConfig
): Promise<unknown> {
  if (config.mode === 'rpc') {
    return execRpcDirect(method, params, config);
  }

  // CLI mode - convert params to strings
  const stringParams = params.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
  const result = await execBitcoinCli(method, stringParams, config);

  // Try to parse JSON response
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * Bitcoin Core PSBT Implementation
 */
export class BitcoinCoreImplementation implements PsbtImplementation {
  name = 'Bitcoin Core';
  version: string;
  private config: BitcoinCoreConfig;

  constructor(config: Partial<BitcoinCoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.version = 'unknown'; // Will be populated by getVersion()
  }

  /**
   * Get Bitcoin Core version
   */
  async getVersion(): Promise<string> {
    const info = await this.getNetworkInfo();
    this.version = info.subversion || 'unknown';
    return this.version;
  }

  async getNetworkInfo(): Promise<{ version: number; subversion: string }> {
    const info = (await execRpc('getnetworkinfo', [], this.config)) as {
      version: number;
      subversion: string;
    };
    this.version = info.subversion || 'unknown';
    return info;
  }

  /**
   * Check if Bitcoin Core is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decode a PSBT and return its structure
   */
  async decodePsbt(psbtBase64: string): Promise<Record<string, unknown>> {
    const result = await execRpc('decodepsbt', [psbtBase64], this.config);
    return result as Record<string, unknown>;
  }

  /**
   * Analyze a PSBT to get fee and other information
   */
  async analyzePsbt(psbtBase64: string): Promise<{
    inputs: Array<{
      has_utxo: boolean;
      is_final: boolean;
      next?: string;
    }>;
    estimated_vsize?: number;
    estimated_feerate?: number;
    fee?: number;
    next?: string;
  }> {
    const result = await execRpc('analyzepsbt', [psbtBase64], this.config);
    return result as {
      inputs: Array<{
        has_utxo: boolean;
        is_final: boolean;
        next?: string;
      }>;
      estimated_vsize?: number;
      estimated_feerate?: number;
      fee?: number;
      next?: string;
    };
  }

  /**
   * Validate a PSBT and return decoded information
   */
  async validatePsbt(psbtBase64: string): Promise<PsbtValidationResult> {
    try {
      const decoded = await this.decodePsbt(psbtBase64);
      const analyzed = await this.analyzePsbt(psbtBase64);

      const tx = decoded.tx as {
        txid: string;
        vin: unknown[];
        vout: unknown[];
      };

      return {
        valid: true,
        decoded: {
          txid: tx.txid,
          inputs: tx.vin.length,
          outputs: tx.vout.length,
          fee: analyzed.fee ? Math.round(analyzed.fee * 100_000_000) : 0,
          vsize: analyzed.estimated_vsize || 0,
          complete: analyzed.next === 'extractor',
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
   * Create an unsigned PSBT from raw transaction hex
   * Note: Bitcoin Core's createpsbt requires a running wallet for full functionality
   */
  async createPsbt(params: {
    inputs: Array<{ txid: string; vout: number }>;
    outputs: Array<{ address: string; amount: number } | { data: string }>;
    locktime?: number;
    replaceable?: boolean;
  }): Promise<string> {
    const { inputs, outputs, locktime = 0, replaceable = true } = params;

    // Format inputs for Bitcoin Core
    const formattedInputs = inputs.map((input) => ({
      txid: input.txid,
      vout: input.vout,
      sequence: replaceable ? 0xfffffffd : 0xffffffff,
    }));

    // Format outputs for Bitcoin Core
    const formattedOutputs = outputs.map((output) => {
      if ('address' in output) {
        return { [output.address]: (output.amount / 1e8).toFixed(8) };
      }
      return { data: output.data };
    });

    const result = await execRpc(
      'createpsbt',
      [formattedInputs, formattedOutputs, locktime, replaceable],
      this.config
    );
    return result as string;
  }

  /**
   * Combine multiple PSBTs into one
   */
  async combinePsbt(psbts: string[]): Promise<string> {
    const result = await execRpc('combinepsbt', [psbts], this.config);
    return result as string;
  }

  /**
   * Finalize a PSBT (create scriptSig/witness from partial signatures)
   */
  async finalizePsbt(psbtBase64: string): Promise<string> {
    const result = (await execRpc('finalizepsbt', [psbtBase64], this.config)) as {
      hex?: string;
      complete: boolean;
    };

    if (!result.complete) {
      throw new Error('PSBT is not complete - missing signatures');
    }

    return result.hex || '';
  }

  /**
   * Convert PSBT to raw transaction hex (requires PSBT to be finalized)
   */
  async extractTransaction(psbtBase64: string): Promise<string> {
    const result = (await execRpc('finalizepsbt', [psbtBase64, true], this.config)) as {
      hex: string;
      complete: boolean;
    };

    if (!result.complete) {
      throw new Error('Cannot extract transaction - PSBT is not complete');
    }

    return result.hex;
  }

  /**
   * Update PSBT with UTXO information from a descriptor
   */
  async utxoUpdatePsbt(psbtBase64: string, descriptors: string[]): Promise<string> {
    const result = await execRpc('utxoupdatepsbt', [psbtBase64, descriptors], this.config);
    return result as string;
  }

  /**
   * Join multiple PSBTs (combine inputs/outputs into a single PSBT)
   */
  async joinPsbts(psbts: string[]): Promise<string> {
    const result = await execRpc('joinpsbts', [psbts], this.config);
    return result as string;
  }
}

/**
 * Create a Bitcoin Core implementation with docker-compose config
 */
export function createDockerBitcoinCore(
  containerName = 'bitcoin-core',
  network: Network = 'regtest'
): BitcoinCoreImplementation {
  return new BitcoinCoreImplementation({
    mode: 'cli',
    network,
    cliPath: `docker exec ${containerName} bitcoin-cli`,
  });
}

/**
 * Create a Bitcoin Core implementation with direct RPC connection
 */
export function createRpcBitcoinCore(
  host: string,
  port: number,
  user: string,
  password: string,
  network: Network = 'regtest'
): BitcoinCoreImplementation {
  return new BitcoinCoreImplementation({
    mode: 'rpc',
    network,
    rpc: { host, port, user, password },
  });
}

export default BitcoinCoreImplementation;

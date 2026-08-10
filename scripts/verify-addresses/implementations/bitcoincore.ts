import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import type {
  ChainEnvironment,
  DerivationEvidence,
  DerivationImplementation,
  DerivationTestCase,
  TestSeed,
} from '../types.js';
import { CORE_CHAIN_ORACLE, PINNED_CORE_VERSION } from '../standardsOracle.js';

const bip32 = BIP32Factory(ecc);
const RPC_USER = process.env.BITCOIN_RPC_USER ?? 'verify';
const RPC_PASS = process.env.BITCOIN_RPC_PASS ?? 'verify';

const ENDPOINTS: Record<ChainEnvironment, string> = {
  mainnet: process.env.BITCOIN_RPC_URL_MAINNET ?? 'http://127.0.0.1:19440',
  testnet3: process.env.BITCOIN_RPC_URL_TESTNET3 ?? 'http://127.0.0.1:19441',
  testnet4: process.env.BITCOIN_RPC_URL_TESTNET4 ?? 'http://127.0.0.1:19442',
  signet: process.env.BITCOIN_RPC_URL_SIGNET ?? 'http://127.0.0.1:19443',
  regtest: process.env.BITCOIN_RPC_URL_REGTEST ?? 'http://127.0.0.1:19444',
};

const EXPECTED_CORE_CHAIN = Object.fromEntries(
  CORE_CHAIN_ORACLE.map(item => [item.environment, item.reportedChain]),
) as Record<ChainEnvironment, string>;

interface RpcRequest { readonly jsonrpc: '2.0'; readonly id: string; readonly method: string; readonly params: unknown[] }
interface RpcResponse<T> { readonly id: string; readonly result?: T; readonly error?: { readonly code: number; readonly message: string } | null }
interface CoreState { readonly chain: string; readonly version: string }

const coreState = new Map<ChainEnvironment, CoreState>();

function request(id: string, method: string, params: unknown[] = []): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

async function rpcBatch<T>(chain: ChainEnvironment, requests: readonly RpcRequest[]): Promise<Map<string, T>> {
  const response = await fetch(ENDPOINTS[chain], {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')}`,
    },
    body: JSON.stringify(requests),
  });
  if (!response.ok) throw new Error(`${chain} RPC HTTP ${response.status} ${response.statusText}`);
  const payload = await response.json() as RpcResponse<T>[];
  if (!Array.isArray(payload) || payload.length !== requests.length) {
    throw new Error(`${chain} RPC returned an incomplete batch`);
  }
  const results = new Map<string, T>();
  for (const item of payload) {
    if (item.error) throw new Error(`${chain} RPC ${item.id}: ${item.error.message} (${item.error.code})`);
    if (item.result === undefined) throw new Error(`${chain} RPC ${item.id} omitted result`);
    results.set(item.id, item.result);
  }
  return results;
}

async function rpc<T>(chain: ChainEnvironment, method: string): Promise<T> {
  const id = `${chain}:${method}`;
  const results = await rpcBatch<T>(chain, [request(id, method)]);
  return results.get(id)!;
}

function versionString(version: number): string {
  const major = Math.floor(version / 10_000);
  const minor = Math.floor((version % 10_000) / 100);
  const patch = version % 100;
  return `${major}.${minor}.${patch}`;
}

async function inspectChain(chain: ChainEnvironment): Promise<CoreState> {
  const [blockchain, network] = await Promise.all([
    rpc<{ chain: string }>(chain, 'getblockchaininfo'),
    rpc<{ version: number }>(chain, 'getnetworkinfo'),
  ]);
  if (blockchain.chain !== EXPECTED_CORE_CHAIN[chain]) {
    throw new Error(`${chain} endpoint reports ${blockchain.chain}, expected ${EXPECTED_CORE_CHAIN[chain]}`);
  }
  const version = versionString(network.version);
  if (version !== PINNED_CORE_VERSION) {
    throw new Error(`${chain} endpoint reports Core ${version}, expected ${PINNED_CORE_VERSION}`);
  }
  return { chain: blockchain.chain, version };
}

function rootPrivateKeys(testCase: DerivationTestCase, seeds: Map<string, TestSeed>): string[] {
  if (new Set(testCase.seedIds).size !== testCase.seedIds.length) {
    throw new Error(`Duplicate seed-derived account key in ${testCase.id}`);
  }
  const network = testCase.derivationFamily === 'mainnet'
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
  const seenAccountKeys = new Set<string>();
  return testCase.seedIds.map(seedId => {
    const seed = seeds.get(seedId);
    if (!seed || !bip39.validateMnemonic(seed.mnemonic)) throw new Error(`Invalid or missing seed: ${seedId}`);
    const root = bip32.fromSeed(bip39.mnemonicToSeedSync(seed.mnemonic), network);
    const account = root.derivePath(testCase.accountPath.slice(2));
    const keyIdentity = `${Buffer.from(account.chainCode).toString('hex')}:${Buffer.from(account.publicKey).toString('hex')}`;
    if (seenAccountKeys.has(keyIdentity)) {
      throw new Error(`Duplicate derived account key material in ${testCase.id}`);
    }
    seenAccountKeys.add(keyIdentity);
    return root.toBase58();
  });
}

const corePath = (path: string): string => path.slice(2).replaceAll("'", 'h');

function rawDescriptor(testCase: DerivationTestCase, roots: readonly string[]): string {
  const keys = roots.map(root => `${root}/${corePath(testCase.accountPath)}/${testCase.branch}/${testCase.index}`);
  if (testCase.kind === 'multisig') {
    const multisig = `sortedmulti(${testCase.threshold},${keys.join(',')})`;
    return testCase.scriptType === 'p2sh_p2wsh' ? `sh(wsh(${multisig}))` : `wsh(${multisig})`;
  }
  if (testCase.scriptType === 'legacy') return `pkh(${keys[0]})`;
  if (testCase.scriptType === 'nested_segwit') return `sh(wpkh(${keys[0]}))`;
  if (testCase.scriptType === 'native_segwit') return `wpkh(${keys[0]})`;
  return `tr(${keys[0]})`;
}

async function deriveChainCases(
  chain: ChainEnvironment,
  cases: readonly DerivationTestCase[],
  seeds: Map<string, TestSeed>,
): Promise<DerivationEvidence[]> {
  const state = coreState.get(chain);
  if (!state) throw new Error(`Bitcoin Core ${chain} endpoint was not inspected`);
  const raw = new Map(cases.map(testCase => [testCase.id, rawDescriptor(testCase, rootPrivateKeys(testCase, seeds))]));
  const descriptorInfo = await rpcBatch<{ descriptor: string; checksum: string }>(chain, cases.map(testCase => (
    request(testCase.id, 'getdescriptorinfo', [raw.get(testCase.id)])
  )));
  const addresses = await rpcBatch<string[]>(chain, cases.map(testCase => (
    request(testCase.id, 'deriveaddresses', [
      `${raw.get(testCase.id)}#${descriptorInfo.get(testCase.id)!.checksum}`,
    ])
  )));
  const validation = await rpcBatch<{ isvalid: boolean; scriptPubKey: string }>(chain, cases.map(testCase => {
    const address = addresses.get(testCase.id)?.[0];
    if (!address) throw new Error(`Bitcoin Core returned no address for ${testCase.id}`);
    return request(testCase.id, 'validateaddress', [address]);
  }));
  return cases.map(testCase => {
    const address = addresses.get(testCase.id)?.[0];
    const validated = validation.get(testCase.id);
    if (!address || !validated?.isvalid || !validated.scriptPubKey) {
      throw new Error(`Bitcoin Core did not validate ${testCase.id}`);
    }
    return {
      caseId: testCase.id,
      implementation: bitcoinCore.name,
      implementationVersion: state.version,
      evidenceScope: 'root-private-descriptor-to-output',
      accountKeys: [],
      address,
      scriptPubKeyHex: validated.scriptPubKey,
      descriptor: descriptorInfo.get(testCase.id)!.descriptor,
      core: state,
    };
  });
}

export const bitcoinCore: DerivationImplementation = {
  id: 'bitcoin-core',
  name: 'Bitcoin Core',
  version: 'unknown',
  async isAvailable() {
    try {
      const inspected = await Promise.all(
        (Object.keys(ENDPOINTS) as ChainEnvironment[]).map(async chain => [chain, await inspectChain(chain)] as const),
      );
      coreState.clear();
      inspected.forEach(([chain, state]) => coreState.set(chain, state));
      const versions = new Set(inspected.map(([, state]) => state.version));
      if (versions.size !== 1) throw new Error('Bitcoin Core endpoints run different versions');
      this.version = inspected[0][1].version;
      return true;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      return false;
    }
  },
  async deriveCases(cases, seeds) {
    if (coreState.size !== Object.keys(ENDPOINTS).length && !await this.isAvailable()) {
      throw new Error(this.unavailableReason ?? 'Bitcoin Core is unavailable');
    }
    const mappedSeeds = new Map(seeds.map(seed => [seed.id, seed]));
    const output: DerivationEvidence[] = [];
    for (const chain of Object.keys(ENDPOINTS) as ChainEnvironment[]) {
      const chainCases = cases.filter(testCase => testCase.chain === chain);
      if (chainCases.length > 0) {
        output.push(...await deriveChainCases(chain, chainCases, mappedSeeds));
      }
    }
    return output;
  },
};

export function getCoreProvenance(): { environment: ChainEnvironment; reportedChain: string; version: string }[] {
  return (Object.keys(ENDPOINTS) as ChainEnvironment[]).map(environment => {
    const state = coreState.get(environment);
    if (!state) throw new Error(`Missing Bitcoin Core provenance for ${environment}`);
    return { environment, reportedChain: state.chain, version: state.version };
  });
}

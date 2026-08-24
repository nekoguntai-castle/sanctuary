import { createHash } from "crypto";
import type { NetworkType } from "./electrumPool";
import type { NodeClientInterface } from "./nodeClient";

const DEFAULT_IDENTITY_TIMEOUT_MS = 10_000;

/**
 * Public-network genesis hashes used as chain identity anchors. A healthy
 * Electrum endpoint can still be the wrong Bitcoin network; block 0 cannot.
 */
const EXPECTED_GENESIS_HASHES: Partial<Record<NetworkType, string>> = {
  mainnet: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  testnet3: "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
  testnet4: "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",
  signet: "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6",
};

const NETWORK_LABELS: Record<NetworkType, string> = {
  mainnet: "Mainnet",
  testnet3: "Testnet3",
  testnet4: "Testnet4",
  signet: "Signet",
  regtest: "Regtest",
};

/** A Bitcoin block header is exactly 80 bytes, so 160 hex characters. */
const BLOCK_HEADER_HEX_PATTERN = /^[0-9a-fA-F]{160}$/;

/**
 * Hash a raw Bitcoin block header using the standard double-SHA256 algorithm.
 * The digest is reversed to the big-endian display order used by block hashes.
 *
 * The input is validated because `Buffer.from(hex, 'hex')` truncates silently at
 * the first invalid pair: `'zzzz'` decodes to zero bytes and `'abc'` to one, so
 * a malformed header would otherwise yield a valid-looking 64-hex digest of the
 * wrong bytes with no error. Header bytes arrive from an Electrum server we do
 * not control, and this digest becomes the block identity in the confirmation
 * job id — and durable reorg evidence once per-network header state lands — so
 * it must fail closed rather than hash whatever it can decode.
 *
 * @throws {Error} if `headerHex` is not exactly 160 hex characters. Callers on a
 * long-running path must handle this rather than let it escape — see the guard
 * in `worker/electrumManager/networkConnection.ts`.
 */
export function hashBlockHeader(headerHex: string): string {
  if (!BLOCK_HEADER_HEX_PATTERN.test(headerHex)) {
    throw new Error('Invalid Bitcoin block header: expected 160 hex characters (80 bytes)');
  }
  const header = Buffer.from(headerHex, "hex");
  const first = createHash("sha256").update(header).digest();
  const second = createHash("sha256").update(first).digest();
  return Buffer.from(second).reverse().toString("hex");
}

export function getExpectedGenesisHash(network: NetworkType): string | null {
  return EXPECTED_GENESIS_HASHES[network] ?? null;
}

function getNetworkLabel(network: NetworkType): string {
  return NETWORK_LABELS[network];
}

async function getGenesisHeaderWithTimeout(
  client: Pick<NodeClientInterface, "getBlockHeader">,
  network: NetworkType,
  timeoutMs: number,
): Promise<string> {
  let timeout!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${getNetworkLabel(network)} chain identity check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      client.getBlockHeader(0),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verify an Electrum-compatible client is serving the selected Bitcoin network.
 * This prevents cross-network address and UTXO contamination when testnet-family
 * endpoints connect successfully but serve a different chain.
 */
export async function verifyNodeClientNetwork(
  client: Pick<NodeClientInterface, "getBlockHeader">,
  network: NetworkType,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const expectedHash = getExpectedGenesisHash(network);
  if (!expectedHash) return;

  const timeoutMs = options.timeoutMs ?? DEFAULT_IDENTITY_TIMEOUT_MS;
  const genesisHeader = await getGenesisHeaderWithTimeout(client, network, timeoutMs);
  const actualHash = hashBlockHeader(genesisHeader);
  if (actualHash === expectedHash) return;

  throw new Error(
    `${getNetworkLabel(network)} chain identity mismatch: expected genesis ${expectedHash}, got ${actualHash}`,
  );
}

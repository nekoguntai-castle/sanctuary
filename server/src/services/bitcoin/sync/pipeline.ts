/**
 * Sync Pipeline Executor
 *
 * Orchestrates the execution of sync phases in sequence.
 */

import { walletRepository, addressRepository } from "../../../repositories";
import { getNodeClient } from "../nodeClient";
import { getElectrumPool } from "../electrumPool";
import { createLogger } from "../../../utils/logger";
import { getErrorMessage } from "../../../utils/errors";
import { walletLog } from "../../../websocket/notifications";
import { getBlockHeight } from "../utils/blockHeight";
import { parseAddressDerivationPath } from "../../../../../shared/utils/bitcoin";

import { createSyncContext } from "./context";
import type {
  SyncContext,
  SyncPhase,
  SyncResult,
  PipelineOptions,
  BitcoinNetwork,
  SyncPipelineError,
} from "./types";

const log = createLogger("BITCOIN:SVC_SYNC_PIPELINE");

interface AddressChainSummary {
  receive: number;
  change: number;
  unknown: number;
}

function summarizeAddressChains(
  addresses: Array<{ derivationPath?: string | null }>,
): AddressChainSummary {
  const summary = { receive: 0, change: 0, unknown: 0 };

  for (const address of addresses) {
    const parsed = parseAddressDerivationPath(address.derivationPath);
    if (!parsed) {
      summary.unknown++;
      continue;
    }
    summary[parsed.chain]++;
  }

  return summary;
}

/**
 * Execute a sync pipeline with the given phases
 */
export async function executeSyncPipeline(
  walletId: string,
  phases: SyncPhase[],
  options?: PipelineOptions,
): Promise<SyncResult> {
  const startTime = Date.now();

  // Load wallet
  const wallet = await walletRepository.findById(walletId);
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  const network = (wallet.network as BitcoinNetwork) || "mainnet";

  // Check if Tor proxy is enabled
  const pool = getElectrumPool();
  const viaTor = pool.isProxyEnabled();

  walletLog(
    walletId,
    "info",
    "SYNC",
    viaTor ? "Starting wallet sync via Tor..." : "Starting wallet sync...",
  );

  // Get node client and current block height
  const client = await getNodeClient(network);
  const currentBlockHeight = await getBlockHeight(network);

  // Load all addresses for the wallet
  const addresses = await addressRepository.findByWalletId(walletId);

  if (addresses.length === 0) {
    walletLog(walletId, "info", "BLOCKCHAIN", "No addresses to scan");
    return {
      addresses: 0,
      transactions: 0,
      utxos: 0,
      stats: {
        historiesFetched: 0,
        transactionsProcessed: 0,
        newTransactionsCreated: 0,
        utxosFetched: 0,
        utxosCreated: 0,
        utxosMarkedSpent: 0,
        addressesUpdated: 0,
        newAddressesGenerated: 0,
        correctedConsolidations: 0,
      },
      elapsedMs: Date.now() - startTime,
    };
  }

  // Log address breakdown
  const chainSummary = summarizeAddressChains(addresses);
  walletLog(
    walletId,
    "info",
    "BLOCKCHAIN",
    `Scanning ${addresses.length} addresses`,
    {
      receive: chainSummary.receive,
      change: chainSummary.change,
      unknown: chainSummary.unknown,
    },
  );

  // Create the sync context
  let ctx = createSyncContext({
    walletId,
    wallet,
    network,
    client,
    addresses,
    currentBlockHeight,
    viaTor,
  });

  // Filter phases based on options
  let phasesToExecute = phases;

  if (options?.onlyPhases && options.onlyPhases.length > 0) {
    phasesToExecute = phases.filter((p) =>
      options.onlyPhases!.includes(p.name),
    );
  } else if (options?.skipPhases && options.skipPhases.length > 0) {
    phasesToExecute = phases.filter(
      (p) => !options.skipPhases!.includes(p.name),
    );
  }

  // Execute phases in sequence
  for (const phase of phasesToExecute) {
    const phaseStart = Date.now();
    log.debug(`[SYNC] Starting phase: ${phase.name}`);

    try {
      ctx = await phase.execute(ctx);
      ctx.completedPhases.push(phase.name);

      const phaseElapsed = Date.now() - phaseStart;
      log.debug(`[SYNC] Completed phase: ${phase.name} (${phaseElapsed}ms)`);

      // Call progress callback if provided
      if (options?.onPhaseComplete) {
        options.onPhaseComplete(phase.name, ctx);
      }
    } catch (error) {
      const pipelineError: SyncPipelineError = {
        name: "SyncPipelineError",
        message: `Sync pipeline failed at phase "${phase.name}": ${getErrorMessage(error)}`,
        cause: error instanceof Error ? error : new Error(String(error)),
        completedPhases: ctx.completedPhases,
        failedPhase: phase.name,
      };
      throw pipelineError;
    }
  }

  // Calculate final results
  const elapsed = Date.now() - startTime;
  const result: SyncResult = {
    addresses: ctx.addresses.length + ctx.newAddresses.length,
    transactions: ctx.stats.newTransactionsCreated,
    utxos: ctx.stats.utxosCreated,
    stats: ctx.stats,
    elapsedMs: elapsed,
  };

  walletLog(
    walletId,
    "info",
    "SYNC",
    `Sync completed in ${(elapsed / 1000).toFixed(1)}s`,
    {
      addresses: result.addresses,
      transactions: result.transactions,
      utxos: result.utxos,
      viaTor,
    },
  );

  return result;
}

/**
 * Create a phase object with name and execute function
 */
export function createPhase(
  name: string,
  execute: (ctx: SyncContext) => Promise<SyncContext>,
): SyncPhase {
  return { name, execute };
}

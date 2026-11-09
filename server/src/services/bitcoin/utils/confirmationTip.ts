/**
 * Confirmation tip height for read paths in any process.
 *
 * The block-height cache in `./blockHeight` is per process. The worker advances
 * its own copy on every new block, but nothing advances the API's copy while
 * the worker is healthy, so API reads computed from it freeze at the startup
 * height. The durable network header checkpoint is the cross-process source
 * the worker persists after header reconciliation (including reorgs), so read
 * paths use it and fall back to the process cache only when no checkpoint
 * exists or it cannot be read.
 */

import { findNetworkHeaderCheckpoint } from "../../../repositories/networkHeaderCheckpointRepository";
import { createLogger } from "../../../utils/logger";
import { getErrorMessage } from "../../../utils/errors";
import { getCachedBlockHeight, type Network } from "./blockHeight";

const log = createLogger("BITCOIN:SVC_CONFIRMATION_TIP");

/** Returns the tip height to compute confirmations from, or 0 when unknown. */
export async function getConfirmationTipHeight(network: Network): Promise<number> {
  try {
    const checkpoint = await findNetworkHeaderCheckpoint(network);
    if (checkpoint && checkpoint.lastProcessedHeight > 0) {
      return checkpoint.lastProcessedHeight;
    }
  } catch (error) {
    log.warn("Header checkpoint unavailable; using process block-height cache", {
      network,
      error: getErrorMessage(error),
    });
    return getCachedBlockHeight(network);
  }
  return getCachedBlockHeight(network);
}

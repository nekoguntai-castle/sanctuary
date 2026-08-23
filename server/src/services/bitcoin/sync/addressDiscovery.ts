/**
 * Address Discovery and Gap Limit Management
 *
 * Handles BIP-44 gap limit expansion to ensure there are always
 * sufficient unused addresses at the end of both receive and change chains.
 */

import { walletRepository, addressRepository } from "../../../repositories";
import { createLogger } from "../../../utils/logger";
import { walletLog } from "../../../websocket/notifications";
import { ADDRESS_GAP_LIMIT } from "../../../constants";
import type { WalletNetwork } from "../../wallet/types";
import { assertWalletHardwareCapabilityById } from "../../hardwareWalletCapabilities";
import { ForbiddenError } from "../../../errors";
import { assertPersistedCanonicalPolicy } from '../../wallet/canonicalPolicy';
import type {
  CanonicalBatchCounts,
  CanonicalBatchState,
  NextCanonicalAddressData,
} from '../../../repositories/addressRepository';
import { buildCanonicalAddressEvidence } from '../../wallet/addressGeneration';
import type { PrismaTxClient } from '../../../models/prisma';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;
type GapLimitDeriver = (branch: 0 | 1, index: number) => NextCanonicalAddressData;

export interface GapLimitExpansionPreparation {
  readonly derive: GapLimitDeriver;
}

const log = createLogger("BITCOIN:SVC_ADDR_DISCOVERY");

function requiredGapCounts(state: CanonicalBatchState): CanonicalBatchCounts {
  return {
    receive: Math.max(0, ADDRESS_GAP_LIMIT - state.receive.unusedTail),
    change: Math.max(0, ADDRESS_GAP_LIMIT - state.change.unusedTail),
  };
}

function logBranchExpansion(
  walletId: string,
  branch: 'receive' | 'change',
  state: CanonicalBatchState,
  counts: CanonicalBatchCounts,
): void {
  const allocation = state[branch];
  const count = counts[branch];
  if (count === 0) return;
  walletLog(
    walletId,
    "info",
    "ADDRESS",
    `Expanding ${branch} addresses (gap: ${allocation.unusedTail}/${ADDRESS_GAP_LIMIT})`,
    { currentMax: allocation.nextIndex - 1, generating: count },
  );
}

/**
 * Check and expand addresses to maintain gap limit
 *
 * BIP-44 specifies a "gap limit" of 20 - the wallet should stop looking for
 * addresses after finding 20 consecutive unused addresses. Conversely, we need
 * to ensure there are always at least 20 unused addresses at the end of both
 * the receive and change chains.
 *
 * Descriptor/policy reads and BIP-32 derivation preparation occur here, before
 * the caller enters its short fenced persistence transaction.
 */
export async function prepareGapLimitExpansion(
  walletId: string,
): Promise<GapLimitExpansionPreparation | null> {
  const wallet = await walletRepository.findByIdWithSelect(walletId, {
    id: true,
    descriptor: true,
    changeDescriptor: true,
    network: true,
    type: true,
    scriptType: true,
    canonicalPolicyId: true,
    canonicalPolicyVersion: true,
  });

  if (!wallet?.descriptor || !wallet.changeDescriptor) {
    log.debug(`Wallet ${walletId} has no descriptor, skipping gap limit check`);
    return null;
  }

  try {
    await assertWalletHardwareCapabilityById(walletId, "display");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      log.warn("Skipping gap expansion while wallet address display is disabled", {
        walletId,
      });
      return null;
    }
    throw error;
  }

  const policy = assertPersistedCanonicalPolicy(wallet);

  const derive: GapLimitDeriver = (branch, index) => {
    return buildCanonicalAddressEvidence(
      wallet.descriptor as string,
      wallet.changeDescriptor as string,
      wallet.network as WalletNetwork,
      { canonicalPolicyId: policy.id, canonicalPolicyVersion: policy.version },
      branch,
      index,
    );
  };
  return { derive };
}

/** Persist one prepared gap expansion through the caller's explicit transaction client. */
export async function persistGapLimitExpansion(
  walletId: string,
  preparation: GapLimitExpansionPreparation,
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<Array<{ address: string; derivationPath: string }>> {

  const addressesToCreate = await addressRepository.createCanonicalBatch(
    walletId,
    (state) => {
      const counts = requiredGapCounts(state);
      const publishExpansion = () => {
        logBranchExpansion(walletId, 'receive', state, counts);
        logBranchExpansion(walletId, 'change', state, counts);
      };
      if (deferPostCommit) deferPostCommit(publishExpansion);
      else publishExpansion();
      return counts;
    },
    preparation.derive,
    tx,
  );

  if (addressesToCreate.length > 0) {
    const publishGenerated = () => walletLog(
      walletId,
      "info",
      "ADDRESS",
      `Generated ${addressesToCreate.length} new addresses to maintain gap limit`,
    );
    if (deferPostCommit) deferPostCommit(publishGenerated);
    else publishGenerated();
  }

  return addressesToCreate.map(({ address, derivationPath }) => ({
    address,
    derivationPath,
  }));
}

export async function ensureGapLimit(
  walletId: string,
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<Array<{ address: string; derivationPath: string }>> {
  const preparation = await prepareGapLimitExpansion(walletId);
  if (!preparation) return [];
  return persistGapLimitExpansion(walletId, preparation, tx, deferPostCommit);
}

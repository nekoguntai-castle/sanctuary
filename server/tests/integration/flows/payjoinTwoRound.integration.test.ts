/**
 * Two-round BIP78 payjoin, end to end against real PostgreSQL
 * (payjoin-attempt--unsigned-original-psbt-sent,
 * signed-artifact--payjoin-peer-input-finalized-rejected).
 *
 * A fake receiver enforces BIP78's rule that the original is signed, finalized
 * and broadcastable. The real payjoin, broadcast and draft routers prove the
 * full two-round flow, the fallback to the original (including the late-persist
 * races), the never-broadcast-both guarantee, and that policy usage is reserved
 * or recorded exactly once, by Sanctuary's own broadcast.
 */
import { describe } from 'vitest';
import { setupPayjoinTwoRoundHarness } from './payjoinTwoRound/payjoinTwoRoundTestHarness';
import { canRunIntegrationTests } from '../setup/testDatabase';
import { registerPayjoinTwoRoundFallbackDraftContracts } from './payjoinTwoRound/payjoinTwoRound.fallback-drafts.contracts';
import { registerPayjoinTwoRoundPolicyContracts } from './payjoinTwoRound/payjoinTwoRound.policy.contracts';
import { registerPayjoinTwoRoundReleaseRaceContracts } from './payjoinTwoRound/payjoinTwoRound.release-race.contracts';
import { registerPayjoinTwoRoundTripContracts } from './payjoinTwoRound/payjoinTwoRound.round-trip.contracts';

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Payjoin two-round signing integration', () => {
  setupPayjoinTwoRoundHarness();

  registerPayjoinTwoRoundTripContracts();
  registerPayjoinTwoRoundReleaseRaceContracts();
  registerPayjoinTwoRoundPolicyContracts();
  registerPayjoinTwoRoundFallbackDraftContracts();
});

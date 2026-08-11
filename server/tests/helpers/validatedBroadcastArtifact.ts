import {
  createValidatedBroadcastArtifactForTest,
  type ValidatedBroadcastArtifact,
} from '../../src/services/bitcoin/signingIntent/artifactValidation';
import type { SigningIntentSnapshotV1 } from '../../src/services/bitcoin/signingIntent/types';

interface ValidatedBroadcastArtifactFixtureInput {
  rawTx: string;
  txid: string;
  walletId: string;
  network: SigningIntentSnapshotV1['network'];
  intentId?: string;
  intentDigest?: string;
  snapshot?: SigningIntentSnapshotV1;
}

const defaultSnapshot = (
  walletId: string,
  network: SigningIntentSnapshotV1['network'],
): SigningIntentSnapshotV1 => ({
  version: 1,
  walletId,
  network,
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [],
    outputs: [],
  },
});

export const createValidatedBroadcastArtifactFixture = (
  input: ValidatedBroadcastArtifactFixtureInput,
): ValidatedBroadcastArtifact => createValidatedBroadcastArtifactForTest({
  rawTx: input.rawTx,
  txid: input.txid,
  walletId: input.walletId,
  network: input.network,
  intent: {
    intentId: input.intentId ?? 'intent-test-fixture',
    intentDigest: input.intentDigest ?? 'a'.repeat(64),
  },
  snapshot: input.snapshot ?? defaultSnapshot(input.walletId, input.network),
});

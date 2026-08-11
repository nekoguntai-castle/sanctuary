import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PsbtProofManifest {
  schemaVersion: 1;
  coreImage: string;
  coreVersion: number;
  coreSubversion: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(scriptDirectory, 'proof-manifest.json');

const parseManifest = (): PsbtProofManifest => {
  const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<PsbtProofManifest>;
  if (value.schemaVersion !== 1
    || typeof value.coreImage !== 'string'
    || !/^bitcoin\/bitcoin:\d+\.\d+@sha256:[0-9a-f]{64}$/.test(value.coreImage)
    || !Number.isSafeInteger(value.coreVersion)
    || typeof value.coreSubversion !== 'string'
    || !/^\/Satoshi:\d+\.\d+\.\d+\/$/.test(value.coreSubversion)) {
    throw new Error('PSBT proof manifest is malformed or not digest-pinned');
  }
  return Object.freeze(value) as PsbtProofManifest;
};

export const PSBT_PROOF_MANIFEST = parseManifest();

export const assertPinnedCoreExecution = (actual: {
  version: number;
  subversion: string;
}): void => {
  if (process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE !== 'pinned-container'
    || process.env.VERIFY_PSBT_CORE_IMAGE !== PSBT_PROOF_MANIFEST.coreImage) {
    throw new Error('PSBT vector generation requires the exact digest-pinned Bitcoin Core container');
  }
  if (actual.version !== PSBT_PROOF_MANIFEST.coreVersion
    || actual.subversion !== PSBT_PROOF_MANIFEST.coreSubversion) {
    throw new Error(
      `Bitcoin Core runtime drift: expected ${PSBT_PROOF_MANIFEST.coreSubversion} `
      + `(${PSBT_PROOF_MANIFEST.coreVersion}), received ${actual.subversion} (${actual.version})`,
    );
  }
};

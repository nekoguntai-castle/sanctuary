import test from "node:test";
import assert from "node:assert/strict";
import {
  checkWalletSafetyClassifier,
  validateClassifier,
} from "../../scripts/ci/check-wallet-safety-classifier.mjs";

test("checked-in wallet-safety classifier is synchronized", async () => {
  await assert.doesNotReject(checkWalletSafetyClassifier());
});

const BROAD_WORKFLOW = `  pull_request:
  merge_group:
  push:
  schedule:
  VERIFY_PSBT_CORE_IMAGE: bitcoin/bitcoin:29.0@sha256:${"a".repeat(64)}
      - run: node scripts/ci/check-wallet-safety-classifier.mjs
      - working-directory: scripts/verify-psbt
        run: npm run verify
      - run: psbt.signed-vectors.test.ts`;
const REPOSITORY_FILES = ["server/src/services/wallet/create.ts", "same"];
const PROOF_MANIFEST = {
  schemaVersion: 1,
  coreImage: `bitcoin/bitcoin:29.0@sha256:${"a".repeat(64)}`,
  coreVersion: 290000,
  coreSubversion: '/Satoshi:29.0.0/',
};

test("event path filters fail closed", () => {
  for (const filter of ["paths", "paths-ignore"]) {
    for (const indentation of ["    ", "      ", "\t"]) {
      assert.throws(
        () => validateClassifier(
          { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
          `${BROAD_WORKFLOW}\n${indentation}${filter}:\n      - 'unrelated/**'`,
          REPOSITORY_FILES,
          PROOF_MANIFEST,
        ),
        /without path filters/,
      );
    }
  }
});

test("a critical path repeated outside an event cannot hide a filtered workflow", () => {
  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
      `${BROAD_WORKFLOW}\n    paths:\n      - 'server/src/services/wallet/**'\n'server/src/services/wallet/**'\n'server/src/services/wallet/**'`,
      REPOSITORY_FILES,
      PROOF_MANIFEST,
    ),
    /without path filters/,
  );
});

test("inline event path filters fail closed", () => {
  for (const filter of ["paths", "paths-ignore"]) {
    assert.throws(
      () => validateClassifier(
        { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
        BROAD_WORKFLOW.replace("  pull_request:", `  pull_request: { ${filter}: ['server/**'] }`),
        REPOSITORY_FILES,
        PROOF_MANIFEST,
      ),
      /without path filters/,
    );
  }
});

test("empty or unresolved inventories fail closed", () => {
  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: [] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
      PROOF_MANIFEST,
    ),
    /unsupported shape/,
  );
  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: ["definitely/not/a/real/path/**"] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
      PROOF_MANIFEST,
    ),
    /does not resolve/,
  );
});

test("duplicate classifier rows are rejected", () => {
  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: ["same", "same"] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
      PROOF_MANIFEST,
    ),
    /unique/,
  );
});

test("mandatory PSBT proof and exact Core image fail closed", () => {
  for (const missing of ["scripts/verify-psbt", "npm run verify", "psbt.signed-vectors.test.ts"]) {
    assert.throws(
      () => validateClassifier(
        { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
        BROAD_WORKFLOW.replace(missing, "removed"),
        REPOSITORY_FILES,
        PROOF_MANIFEST,
      ),
      /mandatory PSBT proof command/,
    );
  }

  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
      BROAD_WORKFLOW.replace(PROOF_MANIFEST.coreImage, `bitcoin/bitcoin:29.0@sha256:${"b".repeat(64)}`),
      REPOSITORY_FILES,
      PROOF_MANIFEST,
    ),
    /must match the proof manifest/,
  );
});

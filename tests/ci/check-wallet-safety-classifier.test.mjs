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
      - run: node scripts/ci/check-wallet-safety-classifier.mjs`;
const REPOSITORY_FILES = ["server/src/services/wallet/create.ts", "same"];

test("event path filters fail closed", () => {
  for (const filter of ["paths", "paths-ignore"]) {
    for (const indentation of ["    ", "      ", "\t"]) {
      assert.throws(
        () => validateClassifier(
          { schemaVersion: 1, paths: ["server/src/services/wallet/**"] },
          `${BROAD_WORKFLOW}\n${indentation}${filter}:\n      - 'unrelated/**'`,
          REPOSITORY_FILES,
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
      ),
      /without path filters/,
    );
  }
});

test("empty or unresolved inventories fail closed", () => {
  assert.throws(
    () => validateClassifier({ schemaVersion: 1, paths: [] }, BROAD_WORKFLOW, REPOSITORY_FILES),
    /unsupported shape/,
  );
  assert.throws(
    () => validateClassifier(
      { schemaVersion: 1, paths: ["definitely/not/a/real/path/**"] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
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
    ),
    /unique/,
  );
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkWalletSyncLifecycleContract,
  parseWalletSyncLifecycleContract,
} from '../../scripts/check-wallet-sync-lifecycle-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const liveContract = JSON.parse(readFileSync(
  path.join(repoRoot, 'config/wallet-sync-lifecycle-contract.json'),
  'utf8',
));
// Construct negative-fixture imports at runtime so the repository-wide root
// layout scanner does not mistake their intentionally retired paths for live
// source imports.
const retiredBlockchainImport = ['..', '..', 'services', 'bitcoin', 'blockchain'].join('/');
const siblingBlockchainImport = ['..', 'services', 'bitcoin', 'blockchain'].join('/');

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixtureContract() {
  const contract = structuredClone(liveContract);
  contract.inventory.directExecutorCalls = [
    {
      callee: 'syncAddress',
      implementationModules: ['server/src/services/bitcoin/blockchain/syncAddress.ts'],
      entries: [],
    },
    {
      callee: 'syncWallet',
      implementationModules: ['server/src/services/bitcoin/blockchain/syncWallet.ts'],
      entries: [
        {
          file: 'server/src/worker/jobs/syncJobs.ts',
          count: 1,
          role: 'canonical_worker_executor',
        },
      ],
    },
  ];
  contract.inventory.symbolReferences = [
    {
      symbol: 'CHECK_STALE_WALLETS_JOB_NAME',
      entries: [{
        file: 'server/src/worker/jobs/syncJobs.ts',
        role: 'legacy_stale_consumer',
      }],
    },
    { symbol: 'SYNC_WALLET_JOB_NAME', entries: [{
      file: 'server/src/worker/jobs/syncJobs.ts',
      role: 'canonical_worker_consumer',
    }] },
    { symbol: 'SYNC_WALLET_JOB_READER_VERSION', entries: [{
      file: 'server/src/jobs/syncJobContract.ts',
      role: 'reader_only_v2_compatibility',
    }] },
    { symbol: 'findStale', entries: [] },
  ];
  contract.inventory.literalReferences = [
    { literal: 'check-stale-wallets', entries: [] },
    { literal: 'sync-wallet', entries: [] },
    { literal: 'sync:stale:', entries: [] },
  ];
  return contract;
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sanctuary-wallet-lifecycle-'));
  const contract = fixtureContract();
  write(root, 'config/wallet-sync-lifecycle-contract.json', `${JSON.stringify(contract, null, 2)}\n`);
  write(
    root,
    'docs/adr/0004-wallet-sync-lifecycle.md',
    contract.requiredInvariantIds.map((id) => `- \`${id}\``).join('\n'),
  );
  write(
    root,
    'server/ARCHITECTURE.md',
    'See docs/adr/0004-wallet-sync-lifecycle.md and config/wallet-sync-lifecycle-contract.json.\n',
  );
  write(
    root,
    'server/src/jobs/syncJobContract.ts',
    'export const SYNC_JOB_CONTRACT_VERSION = 1 as const;\nexport const SYNC_WALLET_JOB_READER_VERSION = 2 as const;\n',
  );
  write(
    root,
    'server/src/worker/jobs/syncJobs.ts',
    `import { syncWallet } from '${retiredBlockchainImport}';\nvoid CHECK_STALE_WALLETS_JOB_NAME;\nvoid SYNC_WALLET_JOB_NAME;\nsyncWallet();\n`,
  );
  return root;
}

test('live compatibility inventory matches production without claiming cutover', () => {
  const result = checkWalletSyncLifecycleContract(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.contract.cutoverComplete, false);
  assert.equal(result.contract.compatibility.staleScheduleState, 'legacy_desired_until_cutover');
  assert.equal(result.contract.compatibility.admissionState, 'dormant_no_production_callers');
});

test('accepts an exact compatibility inventory fixture', () => {
  assert.deepEqual(checkWalletSyncLifecycleContract(createFixture()).errors, []);
});

test('rejects growth in direct execution and wallet-job reference boundaries', () => {
  const root = createFixture();
  write(
    root,
    'server/src/api/newSync.ts',
    `import * as blockchain from '${siblingBlockchainImport}';\nvoid SYNC_WALLET_JOB_NAME;\nblockchain.syncWallet('wallet-1');\n`,
  );
  const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
  assert.match(errors, /direct syncWallet call inventory changed/);
  assert.match(errors, /symbol SYNC_WALLET_JOB_NAME references changed/);
});

test('rejects an aliased low-level executor import outside the baseline', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/aliasSync.ts',
    "import { syncWallet as execute } from '../bitcoin/blockchain';\nexecute('wallet-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /direct syncWallet call inventory changed/,
  );
});

test('rejects stale compatibility entries after a legacy path is removed', () => {
  const root = createFixture();
  write(
    root,
    'server/src/worker/jobs/syncJobs.ts',
    'void CHECK_STALE_WALLETS_JOB_NAME;\nvoid SYNC_WALLET_JOB_NAME;\n',
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /direct syncWallet call inventory changed/,
  );
});

test('rejects premature cutover and lifecycle weakening', () => {
  const cutover = fixtureContract();
  cutover.cutoverComplete = true;
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(cutover)),
    /cutoverComplete must remain false/,
  );

  const weakened = fixtureContract();
  weakened.lifecycle.forbiddenWalletHistoryTriggers = ['elapsed_wall_clock'];
  assert.throws(
    () => parseWalletSyncLifecycleContract(JSON.stringify(weakened)),
    /lifecycle\.forbiddenWalletHistoryTriggers/,
  );
});

test('rejects a production admission caller before the activation release', () => {
  const root = createFixture();
  write(
    root,
    'server/src/services/earlyCutover.ts',
    "import { requestIncrementalSync as request } from '../repositories/syncIntentRepository';\n"
      + "void request('wallet-1');\n",
  );
  assert.match(
    checkWalletSyncLifecycleContract(root).errors.join('\n'),
    /durable admission activated before cutover/,
  );
});

test('requires ADR and architecture links to remain executable documentation', () => {
  const root = createFixture();
  write(root, 'docs/adr/0004-wallet-sync-lifecycle.md', '- `WSYNC-LIFECYCLE-001`\n');
  const errors = checkWalletSyncLifecycleContract(root).errors.join('\n');
  assert.match(errors, /must document WSYNC-ADMISSION-001/);
});

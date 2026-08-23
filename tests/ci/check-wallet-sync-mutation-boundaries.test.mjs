import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkWalletSyncMutationBoundaries,
  parseWalletSyncMutationBoundaryInventory,
} from '../../scripts/check-wallet-sync-mutation-boundaries.mjs';

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function replace(root, relativePath, before, after) {
  const target = path.join(root, relativePath);
  writeFileSync(target, readFileSync(target, 'utf8').replace(before, after));
}

function inventory() {
  return {
    schemaVersion: 1,
    canonicalScopes: [
      'server/src/services/bitcoin/sync/**',
      'server/src/worker/jobs/canonicalIncrementalSync.ts',
    ],
    architecture: {
      fence: {
        file: 'server/src/repositories/syncIntentRepository.ts',
        symbol: 'WalletSyncMutationFence',
        readonlyFields: ['generation', 'leaseToken', 'walletId'],
      },
      boundary: {
        file: 'server/src/services/bitcoin/sync/mutationBoundary.ts',
        symbol: 'runWalletSyncMutation',
        requiredContextProperties: ['mutationFence', 'walletId'],
        callbackParameters: ['tx', 'deferPostCommit'],
      },
    },
    approvedMutationUnits: ['address_usage'],
    callsites: [
      {
        file: 'server/src/services/bitcoin/sync/example.ts',
        enclosingFunction: 'loadWallet',
        repository: 'walletRepository',
        method: 'findById',
        kind: 'read',
        count: 1,
      },
      {
        file: 'server/src/services/bitcoin/sync/example.ts',
        enclosingFunction: 'markUsed',
        repository: 'addressRepository',
        method: 'markAsUsed',
        kind: 'mutation',
        mutationUnits: ['address_usage'],
        transactionClientArgument: 1,
        count: 1,
      },
    ],
  };
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'wallet-sync-mutation-boundary-'));
  const manifest = inventory();
  write(root, 'config/wallet-sync-mutation-boundaries.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write(
    root,
    'server/src/repositories/syncIntentRepository.ts',
    'interface IncrementalSyncFence {\n'
      + '  readonly generation: number;\n'
      + '  readonly leaseToken: string;\n'
      + '}\n'
      + 'export interface WalletSyncMutationFence extends IncrementalSyncFence {\n'
      + '  readonly walletId: string;\n'
      + '}\n',
  );
  write(
    root,
    'server/src/services/bitcoin/sync/mutationBoundary.ts',
    "type SyncContext = { walletId: string; mutationFence?: object };\n"
      + "export async function runWalletSyncMutation(ctx: Pick<SyncContext, 'walletId' | 'mutationFence'>, unit, callback) {\n"
      + "  if (ctx.mutationFence && ctx.mutationFence.walletId !== ctx.walletId) throw new Error('mismatch');\n"
      + '  return prisma.$transaction(tx => callback(tx, () => undefined));\n'
      + '}\n',
  );
  write(
    root,
    'server/src/services/bitcoin/sync/example.ts',
    'export async function loadWallet(walletId) {\n'
      + '  return walletRepository.findById(walletId);\n'
      + '}\n'
      + 'export async function markUsed(ctx, addressId) {\n'
      + "  return runWalletSyncMutation(ctx, 'address_usage', async (tx, deferPostCommit) => {\n"
      + '    const result = await addressRepository.markAsUsed(addressId, tx);\n'
      + "    deferPostCommit(() => walletLog(ctx.walletId, 'info', 'SYNC', 'used'));\n"
      + '    return result;\n'
      + '  });\n'
      + '}\n',
  );
  write(
    root,
    'server/src/worker/jobs/canonicalIncrementalSync.ts',
    'export const canonicalIncrementalSync = true;\n',
  );
  return { root, manifest };
}

function errorsAfter(change) {
  const value = fixture();
  change(value);
  return checkWalletSyncMutationBoundaries(value.root).errors.join('\n');
}

test('accepts an exact fenced mutation inventory', () => {
  const { root } = fixture();
  assert.deepEqual(checkWalletSyncMutationBoundaries(root).errors, []);
});

test('rejects malformed, duplicate, and non-exhaustive manifest entries', () => {
  const value = inventory();
  value.callsites.push(structuredClone(value.callsites[0]));
  assert.throws(
    () => parseWalletSyncMutationBoundaryInventory(JSON.stringify(value)),
    /identities must be unique/,
  );

  const badFields = inventory();
  badFields.architecture.fence.readonlyFields = ['walletId'];
  assert.throws(
    () => parseWalletSyncMutationBoundaryInventory(JSON.stringify(badFields)),
    /readonlyFields must be generation, leaseToken, walletId/,
  );
});

test('rejects added and removed repository callsites', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/newWriter.ts',
      'export const surprise = () => utxoRepository.createMany([], tx);\n',
    );
  }), /uninventoried repository call/);

  assert.match(errorsAfter(({ root }) => {
    write(root, 'server/src/services/bitcoin/sync/example.ts', 'export const empty = true;\n');
  }), /inventoried repository call disappeared/);
});

test('cannot bypass discovery with repository aliases or direct function imports', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/alias.ts',
      "import { utxoRepository as store } from '../../../repositories';\n"
        + 'export const surprise = () => store.createMany([], tx);\n',
    );
  }), /uninventoried repository call/);

  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/direct.ts',
      "import { createMany } from '../../../repositories/utxoRepository';\n"
        + 'export const surprise = () => createMany([], tx);\n',
    );
  }), /direct repository function import createMany bypasses the mutation inventory/);

  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/default.ts',
      "import store from '../../../repositories/utxoRepository';\n"
        + 'export const surprise = () => store.createMany([], tx);\n',
    );
  }), /default repository imports are forbidden/);
});

test('rejects local repository aliases, destructuring, and reassignment', () => {
  for (const [name, statement] of [
    ['object alias', 'const writer = utxoRepository; void writer;'],
    ['method alias', 'const writer = utxoRepository.createMany; void writer;'],
    ['destructuring', 'const { createMany } = utxoRepository; void createMany;'],
    ['reassignment', 'utxoRepository = replacement;'],
  ]) {
    assert.match(errorsAfter(({ root }) => {
      write(
        root,
        `server/src/services/bitcoin/sync/${name.replace(' ', '-')}.ts`,
        "import { utxoRepository } from '../../../repositories';\n"
          + `${statement}\n`,
      );
    }), /repository binding utxoRepository may only be used as a direct method receiver/, name);
  }
});

test('rejects direct Prisma value imports and model writes in canonical scopes', () => {
  for (const [name, source, pattern] of [
    [
      'default',
      "import prisma from '../../../models/prisma';\n"
        + 'export const write = () => prisma.uTXO.create({ data: {} });\n',
      /default Prisma value import prisma is forbidden[\s\S]*direct Prisma\/model call/,
    ],
    [
      'named',
      "import {\n  prisma as database,\n} from '../../../models/prisma';\n"
        + 'export const write = () => database.wallet.update({ where: {} });\n',
      /named Prisma value import database is forbidden[\s\S]*direct Prisma\/model call/,
    ],
    [
      'namespace',
      "import * as database from '../../../models/prisma';\n"
        + 'export const write = () => database.default.address.deleteMany({});\n',
      /namespace Prisma value imports are forbidden[\s\S]*direct Prisma\/model call/,
    ],
  ]) {
    assert.match(errorsAfter(({ root }) => {
      write(root, `server/src/services/bitcoin/sync/prisma-${name}.ts`, source);
    }), pattern, name);
  }
});

test('allows type-only Prisma imports but rejects direct tx writes and aliases', () => {
  assert.doesNotMatch(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/prisma-types.ts',
      "import type { PrismaTxClient } from '../../../models/prisma';\n"
        + "import { type Prisma } from '../../../generated/prisma/client';\n"
        + 'export type Allowed = PrismaTxClient | Prisma.TransactionWhereInput;\n',
    );
  }), /Prisma value import|direct Prisma\/model|Prisma\/model aliases/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      '    const result = await addressRepository.markAsUsed(addressId, tx);',
      '    await tx.uTXO.create({ data: {} });\n'
        + '    const result = await addressRepository.markAsUsed(addressId, tx);',
    );
  }), /direct Prisma\/model call tx\.uTXO\.create is forbidden/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      '    const result = await addressRepository.markAsUsed(addressId, tx);',
      '    const model = tx.uTXO;\n'
        + '    await model.create({ data: {} });\n'
        + '    const result = await addressRepository.markAsUsed(addressId, tx);',
    );
  }), /local Prisma\/model aliases are forbidden/);
});

test('rejects an unfenced mutation or a missing explicit transaction client', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      'export async function loadWallet(walletId) { return walletRepository.findById(walletId); }\n'
        + 'export async function markUsed(ctx, addressId) {\n'
        + '  return addressRepository.markAsUsed(addressId, tx);\n'
        + '}\n',
    );
  }), /must declare explicit tx|outside runWalletSyncMutation/);

  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      'export async function loadWallet(walletId) { return walletRepository.findById(walletId); }\n'
        + 'export async function markUsed(ctx, addressId) {\n'
        + "  return runWalletSyncMutation(ctx, 'address_usage', async (tx, deferPostCommit) => {\n"
        + '    return addressRepository.markAsUsed(addressId);\n'
        + '  });\n'
        + '}\n',
    );
  }), /must be the explicit tx client/);
});

test('rejects long/nested transactions and AsyncLocalStorage proxies', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/longTransaction.ts',
      'export const bad = () => prisma.$transaction(async tx => syncNetwork(tx));\n',
    );
  }), /direct transaction boundary is forbidden/);

  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/proxy.ts',
      "import { AsyncLocalStorage } from 'node:async_hooks';\nexport const proxy = new AsyncLocalStorage();\n",
    );
  }), /AsyncLocalStorage is forbidden/);
});

test('rejects network work and unbuffered effects inside a mutation', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      'export async function loadWallet(walletId) { return walletRepository.findById(walletId); }\n'
        + 'export async function markUsed(ctx, addressId) {\n'
        + "  return runWalletSyncMutation(ctx, 'address_usage', async (tx, deferPostCommit) => {\n"
        + '    await ctx.client.getHistory();\n'
        + "    walletLog(ctx.walletId, 'info', 'SYNC', 'used');\n"
        + '    return addressRepository.markAsUsed(addressId, tx);\n'
        + '  });\n'
        + '}\n',
    );
  }), /network work inside[\s\S]*must be buffered with deferPostCommit/);
});

test('recursively rejects forbidden work hidden in local mutation helpers', () => {
  for (const [name, helper, pattern] of [
    [
      'network',
      'async function hidden(tx) { await client.getHistory(); }',
      /network work inside runWalletSyncMutation is forbidden/,
    ],
    [
      'nested transaction',
      'async function hidden(tx) { await prisma.$transaction(async nested => nested); }',
      /nested transaction inside runWalletSyncMutation is forbidden/,
    ],
    [
      'unbuffered effect',
      "async function hidden(tx) { walletLog('wallet', 'info', 'SYNC', 'bad'); }",
      /walletLog must be buffered with deferPostCommit/,
    ],
  ]) {
    assert.match(errorsAfter(({ root }) => {
      replace(
        root,
        'server/src/services/bitcoin/sync/example.ts',
        '    const result = await addressRepository.markAsUsed(addressId, tx);',
        '    await hidden(tx);\n    const result = await addressRepository.markAsUsed(addressId, tx);',
      );
      const example = path.join(root, 'server/src/services/bitcoin/sync/example.ts');
      writeFileSync(example, `${readFileSync(example, 'utf8')}\n${helper}\n`);
    }), pattern, name);
  }
});

test('allows recursively inspected post-commit effects', () => {
  assert.doesNotMatch(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      '    const result = await addressRepository.markAsUsed(addressId, tx);',
      '    await hidden(tx, deferPostCommit);\n'
        + '    const result = await addressRepository.markAsUsed(addressId, tx);',
    );
    const example = path.join(root, 'server/src/services/bitcoin/sync/example.ts');
    writeFileSync(
      example,
      `${readFileSync(example, 'utf8')}\n`
        + "async function hidden(tx, deferPostCommit) {\n"
        + "  deferPostCommit(() => walletLog('wallet', 'info', 'SYNC', 'good'));\n"
        + '}\n',
    );
  }), /must be buffered with deferPostCommit/);
});

test('fails closed on ambiguous and cyclic mutation helper resolution', () => {
  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      '    const result = await addressRepository.markAsUsed(addressId, tx);',
      '    await hidden(tx);\n    const result = await addressRepository.markAsUsed(addressId, tx);',
    );
    write(root, 'server/src/services/bitcoin/sync/hidden-a.ts', 'async function hidden(tx) {}\n');
    write(root, 'server/src/services/bitcoin/sync/hidden-b.ts', 'async function hidden(tx) {}\n');
  }), /mutation helper hidden is ambiguous/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      '    const result = await addressRepository.markAsUsed(addressId, tx);',
      '    await helperA(tx);\n    const result = await addressRepository.markAsUsed(addressId, tx);',
    );
    const example = path.join(root, 'server/src/services/bitcoin/sync/example.ts');
    writeFileSync(
      example,
      `${readFileSync(example, 'utf8')}\n`
        + 'async function helperA(tx) { await helperB(tx); }\n'
        + 'async function helperB(tx) { await helperA(tx); }\n',
    );
  }), /recursive mutation helper cycle reaches helperA/);
});

test('requires every fence coordinate to be immutable', () => {
  assert.match(errorsAfter(({ root }) => {
    write(
      root,
      'server/src/repositories/syncIntentRepository.ts',
      'export interface WalletSyncMutationFence {\n'
        + '  readonly walletId: string;\n'
        + '  generation: number;\n'
        + '  readonly leaseToken: string;\n'
        + '}\n',
    );
  }), /WalletSyncMutationFence\.generation must be readonly/);
});

test('requires every mutation runner to bind the target wallet with its fence', () => {
  assert.doesNotMatch(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      "runWalletSyncMutation(ctx, 'address_usage'",
      "runWalletSyncMutation({ walletId: ctx.walletId, mutationFence: ctx.mutationFence }, 'address_usage'",
    );
  }), /first argument must prove walletId and mutationFence/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      "runWalletSyncMutation(ctx, 'address_usage'",
      "runWalletSyncMutation({ mutationFence: ctx.mutationFence }, 'address_usage'",
    );
  }), /first argument must prove walletId and mutationFence/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/example.ts',
      "runWalletSyncMutation(ctx, 'address_usage'",
      "runWalletSyncMutation({ wallet: ctx.walletId, mutationFence: ctx.mutationFence }, 'address_usage'",
    );
  }), /first argument must prove walletId and mutationFence/);
});

test('requires the boundary context type to expose walletId and mutationFence', () => {
  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/mutationBoundary.ts',
      "Pick<SyncContext, 'walletId' | 'mutationFence'>",
      "Pick<SyncContext, 'mutationFence'>",
    );
  }), /context type must include mutationFence and walletId/);

  assert.doesNotMatch(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/mutationBoundary.ts',
      "Pick<SyncContext, 'walletId' | 'mutationFence'>",
      '{ walletId: string; mutationFence?: object }',
    );
  }), /context type must include/);

  assert.match(errorsAfter(({ root }) => {
    replace(
      root,
      'server/src/services/bitcoin/sync/mutationBoundary.ts',
      'ctx.mutationFence.walletId !== ctx.walletId',
      'false',
    );
  }), /must reject a fence walletId that differs from ctx.walletId/);
});

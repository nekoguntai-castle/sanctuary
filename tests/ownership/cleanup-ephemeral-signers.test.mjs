import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createEphemeralCleanupSigners } from '../../scripts/ownership/cleanup-ephemeral-signers.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-signers-'));
  const checkoutRoot = path.join(root, 'checkout');
  const keyRoot = path.join(root, 'runtime', 'keys');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  mkdirSync(path.dirname(keyRoot), { mode: 0o700 });
  chmodSync(root, 0o700);
  return { checkoutRoot, keyRoot };
}

test('ephemeral cleanup signers are distinct RSA-3072 role pairs with private modes', () => {
  const state = fixture();
  const signers = createEphemeralCleanupSigners(state);
  assert.notEqual(signers.authorization.fingerprint, signers.evidence.fingerprint);
  for (const role of ['authorization', 'evidence']) {
    assert.equal(statSync(signers[role].privateKeyPath).mode & 0o777, 0o600);
    assert.equal(statSync(signers[role].publicKeyPath).mode & 0o777, 0o600);
    assert.match(signers[role].fingerprint, /^[a-f0-9]{64}$/);
  }
});

test('ephemeral cleanup signer recovery reuses only complete exact pairs', () => {
  const state = fixture();
  const first = createEphemeralCleanupSigners(state);
  const recovered = createEphemeralCleanupSigners(state);
  assert.deepEqual(recovered, first);
});

function foreignPair() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function pendingRole(state, role, files) {
  const pending = path.join(state.keyRoot, `.${role}.pending`);
  mkdirSync(pending, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(pending, name), bytes, { mode: 0o600 });
  }
  return pending;
}

test('a crash between staged key files is discarded and regenerated', () => {
  const state = fixture();
  const foreign = foreignPair();
  const foreignFingerprint = publicKeyFingerprint(foreign.publicKey);
  const pending = pendingRole(state, 'authorization', { 'private.pem': foreign.privateKey });

  const signers = createEphemeralCleanupSigners(state);

  assert.equal(existsSync(pending), false);
  assert.notEqual(signers.authorization.fingerprint, foreignFingerprint);
});

test('a dead creation controller and its partial staging are recovered together', () => {
  const state = fixture();
  mkdirSync(state.keyRoot, { mode: 0o700 });
  pendingRole(state, 'authorization', { 'private.pem': foreignPair().privateKey });
  const lockPath = path.join(state.keyRoot, '.creation-lock');
  const lockModule = pathToFileURL(path.resolve('scripts/ownership/deployment-lock.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { acquireDeploymentLock } from ${JSON.stringify(lockModule)};
    acquireDeploymentLock(process.argv[1], { operationRunId: 'dead-signer-controller' });
  `, lockPath]);
  assert.equal(child.status, 0, child.stderr.toString());

  const signers = createEphemeralCleanupSigners(state);

  assert.match(signers.authorization.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(path.join(state.keyRoot, '.authorization.pending')), false);
});

test('a complete uncommitted pair is never promoted after a crash', () => {
  const state = fixture();
  const foreign = foreignPair();
  const foreignFingerprint = publicKeyFingerprint(foreign.publicKey);
  pendingRole(state, 'evidence', {
    'private.pem': foreign.privateKey, 'public.pem': foreign.publicKey,
  });

  const signers = createEphemeralCleanupSigners(state);

  assert.notEqual(signers.evidence.fingerprint, foreignFingerprint);
});

test('a partial committed role fails closed without replacing foreign identity', () => {
  const state = fixture();
  const foreign = foreignPair();
  const roleRoot = path.join(state.keyRoot, 'authorization');
  mkdirSync(roleRoot, { recursive: true, mode: 0o700 });
  const privatePath = path.join(roleRoot, 'private.pem');
  writeFileSync(privatePath, foreign.privateKey, { mode: 0o600 });

  assert.throws(() => createEphemeralCleanupSigners(state), /partial or contains unexpected/);
  assert.deepEqual(readFileSync(privatePath), Buffer.from(foreign.privateKey));
});

test('a tampered committed pair fails closed instead of being regenerated', () => {
  const state = fixture();
  const original = createEphemeralCleanupSigners(state);
  const originalPrivate = readFileSync(original.authorization.privateKeyPath);
  writeFileSync(original.authorization.publicKeyPath, foreignPair().publicKey, { mode: 0o600 });

  assert.throws(() => createEphemeralCleanupSigners(state), /do not match/);
  assert.deepEqual(readFileSync(original.authorization.privateKeyPath), originalPrivate);
});

test('unsafe or unrecognized staged entries fail closed', () => {
  const unsafe = fixture();
  const unsafePending = pendingRole(unsafe, 'authorization', {});
  symlinkSync('/dev/null', path.join(unsafePending, 'private.pem'));
  assert.throws(() => createEphemeralCleanupSigners(unsafe), /unsafe entry/);
  assert.equal(lstatSync(path.join(unsafePending, 'private.pem')).isSymbolicLink(), true);

  const unexpected = fixture();
  const unexpectedPending = pendingRole(unexpected, 'authorization', {
    'foreign.txt': Buffer.from('foreign'),
  });
  assert.throws(() => createEphemeralCleanupSigners(unexpected), /unexpected files/);
  assert.equal(existsSync(path.join(unexpectedPending, 'foreign.txt')), true);
});

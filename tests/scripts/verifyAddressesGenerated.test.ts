import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertPinnedCoreExecution,
  assertPinnedPythonExecution,
  assertPythonVerifierSource,
  calculateSourceSha256,
  writeAtomically,
} from '../../scripts/verify-addresses/generate-vectors';
import { VERIFIER_SOURCE_FILES } from '../../scripts/verify-addresses/sourceManifest';
import {
  CORE_ACCOUNT_METADATA_PROBE,
  CORE_CHAIN_ORACLE,
  PINNED_CORE_IMAGE,
  PINNED_CORE_VERSION,
  PINNED_GO_VERSION,
  PINNED_NODE_VERSION,
  PINNED_PYTHON_EFFECTIVE_UID,
  PINNED_PYTHON_BASE_IMAGE,
  PINNED_PYTHON_VERSION,
  PYTHON_VERIFIER_IMAGE,
} from '../../scripts/verify-addresses/standardsOracle';
import {
  VERIFIED_MULTISIG_VECTORS,
  VERIFIED_SINGLESIG_VECTORS,
  VERIFIER_PROVENANCE,
} from '../../scripts/verify-addresses/output/verified-vectors';

describe('generated address vector provenance', () => {
  it('is tied to the current verifier source and exact implementation set', () => {
    expect(VERIFIER_PROVENANCE.sourceSha256).toBe(calculateSourceSha256());
    expect(VERIFIER_PROVENANCE.exactCaseCount).toBe(480);
    expect(VERIFIER_PROVENANCE.implementations.map(item => item.id)).toEqual([
      'bitcoin-core', 'bitcoinjs-lib', 'bip-utils-python', 'btcd-go',
    ]);
    expect(VERIFIER_PROVENANCE.coreChains.map(item => item.environment)).toEqual([
      'mainnet', 'testnet3', 'testnet4', 'signet', 'regtest',
    ]);
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/verify-addresses/generate-vectors.ts');
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/verify-addresses/package.json');
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/verify-addresses/package-lock.json');
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/verify-addresses/requirements.lock');
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/verify-addresses/python-verifier.Dockerfile');
    expect(VERIFIER_SOURCE_FILES).toContain('scripts/ci/docker-endpoint-lib.sh');
    expect(VERIFIER_PROVENANCE.coreImage).toBe(PINNED_CORE_IMAGE);
    expect(VERIFIER_PROVENANCE.runtimes).toMatchObject({
      node: PINNED_NODE_VERSION,
      python: PINNED_PYTHON_VERSION,
      pythonEffectiveUid: PINNED_PYTHON_EFFECTIVE_UID,
      pythonImage: PYTHON_VERIFIER_IMAGE,
      go: PINNED_GO_VERSION,
    });
    expect(VERIFIER_PROVENANCE.runtimes.pythonRequirementsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(VERIFIER_PROVENANCE.runtimes.pythonDependencyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(VERIFIER_PROVENANCE.runtimes.pythonVerifierSourceSha256).toBe(
      createHash('sha256')
        .update(readFileSync('scripts/verify-addresses/implementations/python-verify.py'))
        .digest('hex'),
    );
    expect(VERIFIER_PROVENANCE.coreChains).toEqual(
      CORE_CHAIN_ORACLE.map(item => ({ ...item, version: PINNED_CORE_VERSION })),
    );
    expect(VERIFIER_PROVENANCE.evidenceScopes).toEqual([
      { implementation: 'Bitcoin Core 29.0.0', scope: 'root-private-descriptor-to-output' },
      { implementation: 'bitcoinjs-lib 7.0.1', scope: 'seed-to-account-and-output' },
      { implementation: 'bip_utils (Python) 2.12.1', scope: 'seed-to-account-and-output' },
      { implementation: 'btcd/btcutil (Go) btcd 0.25.0 + go-bip39 1.1.0', scope: 'seed-to-account-and-output' },
    ]);
    expect(VERIFIER_PROVENANCE.adversarialProofs.map(proof => proof.id)).toEqual([
      'reversed-sortedmulti', 'duplicate-key-rejection', 'invalid-seed-rejection',
      'invalid-extended-public-key-rejection',
    ]);
    expect(VERIFIER_PROVENANCE.adversarialProofs).toEqual([
      expect.objectContaining({ scope: 'four-way-core-derived-output', verifiedBy: expect.arrayContaining(['Bitcoin Core 29.0.0']) }),
      expect.objectContaining({ scope: 'adapter-input-validation' }),
      expect.objectContaining({ scope: 'adapter-input-validation' }),
      expect.objectContaining({ scope: 'verifier-xpub-boundary', verifiedBy: ['SLIP-132/BIP32 verifier decoder'] }),
    ]);
  });

  it('documents why Core evidence stops at root-descriptor-to-output scope', () => {
    expect(CORE_ACCOUNT_METADATA_PROBE).toEqual({
      inputShape: 'wpkh(root-tprv/84h/1h/0h/<0;1>/*)',
      returnedShape: 'wpkh(root-tpub/84h/1h/0h/0/*)',
      hasPrivateKeys: true,
      exposesAccountExtendedPublicKey: false,
    });
  });

  it('locks the exact local Node runtime used after the CI bootstrap', () => {
    const packageJson = readFileSync('scripts/verify-addresses/package.json', 'utf8');
    const packageLock = readFileSync('scripts/verify-addresses/package-lock.json', 'utf8');
    expect(packageJson).toContain('"node-linux-x64": "24.19.0"');
    expect(packageLock).toContain('"node_modules/node-linux-x64"');
    expect(packageLock).toContain('sha512-vRk8mXc3mi3oveQf8wNrLKMuJWK7mBEi2ASQ8+Tv/0QjebLcsdodqVzE0xvCKPZ3575pG2jfWsKnfCVkoeIKTw==');
  });

  it('locks the exact isolated Python runtime and hash-verified dependencies', () => {
    const dockerfile = readFileSync('scripts/verify-addresses/python-verifier.Dockerfile', 'utf8');
    expect(dockerfile).toContain(`FROM ${PINNED_PYTHON_BASE_IMAGE}`);
    expect(dockerfile).toContain('--require-hashes -r requirements.lock');
    expect(dockerfile).toContain('useradd --uid 65532 --gid 65532 --no-create-home');
    expect(dockerfile).toContain('USER 65532:65532');
    expect(dockerfile).toContain('ENTRYPOINT ["python", "/opt/verifier/python-verify.py"]');
  });

  it('keeps Compose image/network isolation and generated provenance in exact parity', () => {
    const compose = readFileSync('scripts/verify-addresses/docker-compose.yml', 'utf8');
    expect(compose).toContain(`image: ${PINNED_CORE_IMAGE}`);
    expect(compose.match(/- -connect=0/g)).toHaveLength(CORE_CHAIN_ORACLE.length);
    expect(compose.match(/- -uacomment=\$\{VERIFY_ADDRESSES_CORE_IDENTITY:\?\}/g))
      .toHaveLength(CORE_CHAIN_ORACLE.length);
    expect(compose).not.toContain('-rpcuser=verify');
    expect(compose).not.toContain('-rpcpassword=verify');
    expect(Array.from(compose.matchAll(/^\s+- -chain=(\S+)$/gm), match => match[1]))
      .toEqual(CORE_CHAIN_ORACLE.map(item => item.reportedChain));
  });

  it('refuses to attest Core unless the pinned Compose launcher supplied exact provenance', () => {
    const originalMode = process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE;
    const originalImage = process.env.VERIFY_ADDRESSES_CORE_IMAGE;
    try {
      delete process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE;
      delete process.env.VERIFY_ADDRESSES_CORE_IMAGE;
      expect(() => assertPinnedCoreExecution()).toThrow('digest-pinned');
      process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE = 'pinned-compose';
      process.env.VERIFY_ADDRESSES_CORE_IMAGE = 'bitcoin/bitcoin:29.0';
      expect(() => assertPinnedCoreExecution()).toThrow('digest-pinned');
      process.env.VERIFY_ADDRESSES_CORE_IMAGE = PINNED_CORE_IMAGE;
      expect(() => assertPinnedCoreExecution()).not.toThrow();
    } finally {
      if (originalMode === undefined) delete process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE;
      else process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE = originalMode;
      if (originalImage === undefined) delete process.env.VERIFY_ADDRESSES_CORE_IMAGE;
      else process.env.VERIFY_ADDRESSES_CORE_IMAGE = originalImage;
    }
  });

  it('refuses to attest Python unless the pinned image was the executed implementation', () => {
    const originalCommand = process.env.VERIFY_ADDRESSES_PYTHON;
    const originalImageId = process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID;
    const originalMode = process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE;
    try {
      delete process.env.VERIFY_ADDRESSES_PYTHON;
      delete process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID;
      delete process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE;
      expect(() => assertPinnedPythonExecution()).toThrow('immutable locally built');
      process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
      expect(() => assertPinnedPythonExecution()).toThrow('immutable locally built');
      process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE = 'local-iid';
      expect(() => assertPinnedPythonExecution()).not.toThrow();
      process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = 'sha256:malformed';
      expect(() => assertPinnedPythonExecution()).toThrow('immutable locally built');
      process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
      process.env.VERIFY_ADDRESSES_PYTHON = '/tmp/python';
      expect(() => assertPinnedPythonExecution()).toThrow('forbids the host Python override');
    } finally {
      if (originalCommand === undefined) delete process.env.VERIFY_ADDRESSES_PYTHON;
      else process.env.VERIFY_ADDRESSES_PYTHON = originalCommand;
      if (originalImageId === undefined) delete process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID;
      else process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = originalImageId;
      if (originalMode === undefined) delete process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE;
      else process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE = originalMode;
    }
  });

  it('refuses to attest a Python image containing different verifier source', () => {
    expect(() => assertPythonVerifierSource('0'.repeat(64))).toThrow(
      'Python verifier image source does not match the checked-out verifier',
    );
    expect(assertPythonVerifierSource(
      createHash('sha256')
        .update(readFileSync('scripts/verify-addresses/implementations/python-verify.py'))
        .digest('hex'),
    )).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contains exactly the declared non-vacuous matrix', () => {
    const vectors = [...VERIFIED_SINGLESIG_VECTORS, ...VERIFIED_MULTISIG_VECTORS];
    expect(vectors).toHaveLength(VERIFIER_PROVENANCE.exactCaseCount);
    expect(new Set(vectors.map(vector => vector.caseId)).size).toBe(vectors.length);
    expect(vectors.every(vector => vector.verifiedBy.length === 4)).toBe(true);
    expect(vectors.every(vector => vector.expectedAddress && vector.expectedScriptPubKey)).toBe(true);
  });

  it('keeps every account/branch/index output unique within an exact chain policy and quorum', () => {
    const vectors = [...VERIFIED_SINGLESIG_VECTORS, ...VERIFIED_MULTISIG_VECTORS];
    const groups = new Map<string, typeof vectors>();
    for (const vector of vectors) {
      const policyId = vector.caseId.split(':')[1];
      const quorum = 'threshold' in vector ? `${vector.threshold}of${vector.totalKeys}` : 'single';
      const groupKey = `${policyId}:${vector.network}:${quorum}`;
      const group = groups.get(groupKey) ?? [];
      group.push(vector);
      groups.set(groupKey, group);
    }
    for (const [groupKey, group] of groups) {
      const coordinates = group.map(vector => `${vector.account}:${vector.branch}:${vector.index}`);
      const outputs = group.map(vector => `${vector.expectedAddress}:${vector.expectedScriptPubKey}`);
      expect(new Set(coordinates).size, `${groupKey} coordinate coverage`).toBe(group.length);
      expect(new Set(outputs).size, `${groupKey} distinct outputs`).toBe(group.length);
    }
  });

  it('publishes byte-identical verifier and server fixtures', () => {
    expect(readFileSync('server/tests/fixtures/verified-address-vectors.ts', 'utf8')).toBe(
      readFileSync('scripts/verify-addresses/output/verified-vectors.ts', 'utf8'),
    );
  });

  it('rolls both generated artifacts back if a later rename fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sanctuary-vector-write-'));
    const paths = [join(directory, 'first.ts'), join(directory, 'second.ts')];
    try {
      writeFileSync(paths[0], 'first-old');
      writeFileSync(paths[1], 'second-old');
      let renameCount = 0;
      expect(() => writeAtomically(paths, 'new-content', (source, destination) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error('simulated second rename failure');
        const content = readFileSync(source);
        writeFileSync(destination, content);
        rmSync(source);
      })).toThrow('simulated second rename failure');
      expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(['first-old', 'second-old']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

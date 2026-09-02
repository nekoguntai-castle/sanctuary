import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import { sha256 } from './crypto.mjs';
import { assertDeploymentLock } from './deployment-lock.mjs';
import {
  retireActiveEphemeralRevision, retireFailedEphemeralRevision,
} from './deployment-ephemeral-retirement.mjs';
import {
  ensureOwnerDirectory, fsyncDirectory, readCanonical, readOptional, readStableBytes,
  writeAtomic, writeCreateOnly,
} from './deployment-store-io.mjs';
import {
  assertDeploymentId, assertDigest, assertPointer, deploymentIdentityRecord,
  identityRecordsMatch, pendingIsActivating, preparedMatchesPending,
  validDeploymentIdentifier, validateDefinitionBundle, withoutDigest,
} from './deployment-store-validation.mjs';
import { validateArtifact } from './schemas.mjs';
import { PROTECTED_COMPOSE_PROJECTS } from './contracts.mjs';
import { assertProjectMutationLock } from './project-lock.mjs';

const DEPLOY_STAGES = ['prepared', 'build_started', 'build_completed', 'postgres_started', 'password_reconciled', 'stack_started', 'health_verified', 'activating'];
const ROLLBACK_STAGES = ['rollback_prepared', 'rollback_stack_started', 'rollback_health_verified', 'rollback_activating'];

export class DeploymentStore {
  constructor({ runtimeDirectory, deploymentId }) {
    assertDeploymentId(deploymentId);
    this.deploymentId = deploymentId;
    this.runtimeDirectory = path.resolve(runtimeDirectory);
    this.root = path.join(this.runtimeDirectory, 'ownership', 'deployments', deploymentId);
    this.revisions = path.join(this.root, 'revisions');
    this.lockPath = path.join(this.root, 'mutation-lock');
    this.activePath = path.join(this.root, 'active-revision.json');
    this.pendingPath = path.join(this.root, 'pending-revision.json');
    this.preparedPath = path.join(this.root, 'prepared-revision.json');
    this.identityPath = path.join(this.root, 'identity.json');
    this.retiredRevisions = path.join(this.root, 'retired-revisions');
  }

  initialize(identity) {
    ensureOwnerDirectory(this.root);
    ensureOwnerDirectory(this.revisions);
    const record = deploymentIdentityRecord(this.deploymentId, identity);
    if (!existsSync(this.identityPath)) writeCreateOnly(this.identityPath, canonicalJson(record));
    else {
      const existing = readCanonical(this.identityPath).value;
      if (!identityRecordsMatch(existing, record)) {
        throw new Error('deployment identity does not match existing store');
      }
      return existing;
    }
    return record;
  }

  readIdentity() { return readCanonical(this.identityPath).value; }

  assertLocked(token, operationRunId) { return assertDeploymentLock(this.lockPath, token, operationRunId); }

  readActive() {
    const active = readOptional(this.activePath);
    if (!active) return null;
    assertPointer(active.value, 'active');
    if (active.value.deploymentId !== this.deploymentId) throw new Error('active pointer deployment identity mismatch');
    const manifest = this.readManifest(active.value.generation);
    if (manifest.manifestDigest !== active.value.manifestDigest) throw new Error('active pointer manifest digest mismatch');
    return active;
  }
  readPending() {
    const pending = readOptional(this.pendingPath);
    if (!pending) return null;
    assertPointer(pending.value, 'pending');
    if (pending.value.deploymentId !== this.deploymentId
        || !validDeploymentIdentifier(pending.value.operationRunId)) {
      throw new Error('pending pointer identity mismatch');
    }
    if (!['deploy', 'rollback'].includes(pending.value.mode)) throw new Error('pending pointer mode is invalid');
    const manifest = this.readManifest(pending.value.generation);
    if (manifest.manifestDigest !== pending.value.manifestDigest) throw new Error('pending pointer manifest digest mismatch');
    return pending;
  }

  reconcilePointers({ operationRunId, lockToken }) {
    this.assertLocked(lockToken, operationRunId);
    const active = this.readActive();
    let pending = this.readPending();
    let prepared = readOptional(this.preparedPath);
    let changed = false;
    if (pending && prepared) {
      if (!preparedMatchesPending(prepared.value, pending.value)) {
        throw new Error('ambiguous pending and prepared deployment pointers');
      }
      unlinkSync(this.preparedPath);
      prepared = null;
      changed = true;
    }
    if (pending && active && active.value.manifestDigest === pending.value.manifestDigest) {
      if (!pendingIsActivating(pending.value)) throw new Error('ambiguous active and pending deployment pointers');
      unlinkSync(this.pendingPath);
      pending = null;
      changed = true;
    }
    if (prepared && active && active.value.manifestDigest === prepared.value.manifestDigest) {
      unlinkSync(this.preparedPath);
      changed = true;
    }
    if (changed) fsyncDirectory(this.root);
    return this.inspect();
  }

  nextGeneration() {
    const generations = readdirSync(this.revisions, { withFileTypes: true }).map((entry) => {
      if (!entry.isDirectory() || !/^[1-9][0-9]*$/.test(entry.name)) throw new Error(`ambiguous revision entry: ${entry.name}`);
      return Number(entry.name);
    });
    if (generations.some((entry) => !Number.isSafeInteger(entry))) throw new Error('revision generation is outside the safe integer range');
    return (generations.length === 0 ? 0 : Math.max(...generations)) + 1;
  }

  prepareRevision({ bundle, expectedActiveDigest = null, operationRunId, lockToken, legacyResources = [], now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    validateDefinitionBundle(bundle);
    const identity = this.readIdentity();
    if (identity.projectDirectory !== bundle.definition.projectDirectory || identity.composeProjectName !== bundle.definition.composeProjectName) {
      throw new Error('deployment definition does not match stable deployment identity');
    }
    if (this.readPending()) throw new Error('a deployment revision is already pending');
    const active = this.readActive();
    if ((active?.value.manifestDigest ?? null) !== expectedActiveDigest) throw new Error('active revision compare-and-swap failed');
    const generation = this.nextGeneration();
    const revisionRoot = path.join(this.revisions, String(generation));
    mkdirSync(revisionRoot, { mode: 0o700 });
    ensureOwnerDirectory(path.join(revisionRoot, 'compose'));
    ensureOwnerDirectory(path.join(revisionRoot, 'transitions'));
    for (const snapshot of bundle.snapshots) {
      const target = path.join(revisionRoot, snapshot.snapshotPath);
      writeCreateOnly(target, snapshot.bytes);
    }
    const createdAt = now().toISOString();
    const manifest = {
      schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId: this.deploymentId,
      generation, createdAt, priorActiveDigest: expectedActiveDigest, ...bundle.definition, legacyResources,
    };
    const manifestDigest = canonicalSha256(manifest);
    writeCreateOnly(path.join(revisionRoot, 'deployment-manifest.json'), canonicalJson(manifest));
    const pending = {
      pointerVersion: 1, mode: 'deploy', deploymentId: this.deploymentId, operationRunId,
      generation, manifestDigest, priorActiveDigest: expectedActiveDigest, stage: 'prepared',
      sequence: 0, createdAt, updatedAt: createdAt,
    };
    writeCreateOnly(this.pendingPath, canonicalJson(pending));
    return { manifest, manifestDigest, pending, pendingDigest: canonicalSha256(pending) };
  }

  transitionPending({ operationRunId, lockToken, expectedPendingDigest, nextStage, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    const current = this.readPending();
    if (!current || current.digest !== expectedPendingDigest) throw new Error('pending revision compare-and-swap failed');
    if (current.value.operationRunId !== operationRunId) throw new Error('pending revision belongs to another operation');
    const stages = current.value.mode === 'rollback' ? ROLLBACK_STAGES : DEPLOY_STAGES;
    const index = stages.indexOf(current.value.stage);
    if (stages[index + 1] !== nextStage) throw new Error(`invalid pending transition: ${current.value.stage} -> ${nextStage}`);
    let next = { ...current.value, stage: nextStage, sequence: current.value.sequence + 1, updatedAt: now().toISOString() };
    let transition = { transitionVersion: 1, sequence: next.sequence, priorPointerDigest: current.digest, nextPointer: next };
    const transitionDirectory = path.join(this.revisions, String(current.value.generation), 'transitions', operationRunId);
    ensureOwnerDirectory(transitionDirectory);
    const transitionPath = path.join(transitionDirectory, `${String(next.sequence).padStart(4, '0')}.json`);
    if (existsSync(transitionPath)) {
      transition = readCanonical(transitionPath).value;
      if (transition.priorPointerDigest !== current.digest || transition.sequence !== next.sequence || transition.nextPointer.stage !== nextStage) {
        throw new Error('pending transition record collision');
      }
      next = transition.nextPointer;
    } else writeCreateOnly(transitionPath, canonicalJson(transition));
    writeAtomic(this.pendingPath, canonicalJson(next));
    return { pending: next, pendingDigest: canonicalSha256(next) };
  }

  resumePending({ operationRunId, lockToken, expectedPendingDigest, expectedDefinitionDigest, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    const current = this.readPending();
    if (!current || current.digest !== expectedPendingDigest) throw new Error('pending revision compare-and-swap failed');
    if (current.value.mode !== 'deploy') throw new Error('rollback recovery requires the rollback controller');
    const manifest = this.readManifest(current.value.generation, { verifySnapshots: true });
    if (manifest.manifest.definitionDigest !== expectedDefinitionDigest) {
      throw new Error('pending revision definition differs from the requested deployment');
    }
    const active = this.readActive();
    if ((active?.value.manifestDigest ?? null) !== current.value.priorActiveDigest) {
      throw new Error('active revision changed before pending recovery');
    }
    if (current.value.operationRunId === operationRunId) {
      return { pending: current.value, pendingDigest: current.digest };
    }
    let next = {
      ...current.value, operationRunId, sequence: current.value.sequence + 1,
      updatedAt: now().toISOString(),
    };
    const recovery = {
      recoveryVersion: 1, priorOperationRunId: current.value.operationRunId,
      priorPointerDigest: current.digest, nextPointer: next,
    };
    const recoveryDirectory = path.join(this.revisions, String(current.value.generation), 'transitions', operationRunId);
    ensureOwnerDirectory(recoveryDirectory);
    const recoveryPath = path.join(recoveryDirectory, `${String(next.sequence).padStart(4, '0')}-resume.json`);
    if (existsSync(recoveryPath)) {
      const recorded = readCanonical(recoveryPath).value;
      if (recorded.priorPointerDigest !== current.digest
        || recorded.priorOperationRunId !== current.value.operationRunId
        || recorded.nextPointer.operationRunId !== operationRunId
        || recorded.nextPointer.generation !== current.value.generation
        || recorded.nextPointer.manifestDigest !== current.value.manifestDigest
        || recorded.nextPointer.stage !== current.value.stage
        || recorded.nextPointer.sequence !== next.sequence) {
        throw new Error('pending recovery record collision');
      }
      next = recorded.nextPointer;
    } else writeCreateOnly(recoveryPath, canonicalJson(recovery));
    writeAtomic(this.pendingPath, canonicalJson(next));
    return { pending: next, pendingDigest: canonicalSha256(next) };
  }

  activateRevision({ operationRunId, lockToken, expectedPendingDigest, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    let pending = this.readPending();
    if (!pending || pending.digest !== expectedPendingDigest) throw new Error('pending revision compare-and-swap failed');
    if (pending.value.mode !== 'deploy' || !['health_verified', 'activating'].includes(pending.value.stage)) throw new Error('deployment revision is not health verified');
    if (pending.value.stage === 'health_verified') {
      const transitioned = this.transitionPending({ operationRunId, lockToken, expectedPendingDigest, nextStage: 'activating', now });
      pending = { value: transitioned.pending, digest: transitioned.pendingDigest };
    }
    const active = { pointerVersion: 1, deploymentId: this.deploymentId, generation: pending.value.generation, manifestDigest: pending.value.manifestDigest, activatedAt: now().toISOString() };
    const existing = this.readActive();
    if (existing && existing.value.manifestDigest !== pending.value.priorActiveDigest && existing.value.manifestDigest !== active.manifestDigest) {
      throw new Error('active revision changed during activation');
    }
    if (!existing || existing.value.manifestDigest !== active.manifestDigest) writeAtomic(this.activePath, canonicalJson(active));
    unlinkSync(this.pendingPath);
    fsyncDirectory(this.root);
    return { active, activeDigest: canonicalSha256(active) };
  }

  finalizePreparedRevision({ operationRunId, lockToken, expectedPendingDigest, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    const pending = this.readPending();
    if (!pending || pending.digest !== expectedPendingDigest) throw new Error('pending revision compare-and-swap failed');
    if (pending.value.mode !== 'deploy' || pending.value.stage !== 'prepared') throw new Error('only an unstarted prepared revision can be finalized without activation');
    const prepared = {
      pointerVersion: 1, deploymentId: this.deploymentId, generation: pending.value.generation,
      manifestDigest: pending.value.manifestDigest, priorActiveDigest: pending.value.priorActiveDigest,
      preparedAt: now().toISOString(),
    };
    writeAtomic(this.preparedPath, canonicalJson(prepared));
    unlinkSync(this.pendingPath);
    fsyncDirectory(this.root);
    return { prepared, preparedDigest: canonicalSha256(prepared) };
  }

  activatePreparedEphemeralRevision({
    operationRunId, lockToken, projectLockToken, expectedPreparedDigest,
    now = () => new Date(),
  }) {
    this.assertLocked(lockToken, operationRunId);
    const identity = this.readIdentity();
    assertProjectMutationLock(
      this.runtimeDirectory, identity.composeProjectName, projectLockToken, operationRunId,
    );
    if (identity.identityVersion !== 2 || identity.deploymentScope !== 'ci_ephemeral'
        || PROTECTED_COMPOSE_PROJECTS.includes(identity.composeProjectName)) {
      throw new Error('prepared activation is restricted to unprotected CI-ephemeral deployments');
    }
    if (this.readPending()) throw new Error('ephemeral activation refuses a pending revision');
    const prepared = readOptional(this.preparedPath);
    const active = this.readActive();
    const generation = prepared?.value.generation ?? active?.value.generation;
    if (!generation) throw new Error('prepared ephemeral revision is missing');
    const transitionDirectory = path.join(
      this.revisions, String(generation), 'transitions', operationRunId,
    );
    ensureOwnerDirectory(transitionDirectory);
    const transitionPath = path.join(transitionDirectory, 'ephemeral-activation.json');
    const existingTransition = readOptional(transitionPath);
    if (!prepared) {
      if (!active || !existingTransition
          || existingTransition.value.preparedDigest !== expectedPreparedDigest
          || existingTransition.value.manifestDigest !== active.value.manifestDigest) {
        throw new Error('prepared ephemeral activation compare-and-swap failed');
      }
      return { active: active.value, activeDigest: active.digest };
    }
    if (active && existingTransition
        && prepared.digest === expectedPreparedDigest
        && existingTransition.value.preparedDigest === expectedPreparedDigest
        && existingTransition.value.manifestDigest === active.value.manifestDigest
        && canonicalJson(existingTransition.value.nextActive).equals(canonicalJson(active.value))) {
      unlinkSync(this.preparedPath);
      fsyncDirectory(this.root);
      return { active: active.value, activeDigest: active.digest };
    }
    if (prepared.digest !== expectedPreparedDigest || prepared.value.priorActiveDigest !== null
        || active !== null) {
      throw new Error('prepared ephemeral activation compare-and-swap failed');
    }
    const revision = this.readManifest(prepared.value.generation, { verifySnapshots: true });
    if (revision.manifestDigest !== prepared.value.manifestDigest
        || revision.manifest.legacyResources.length !== 0) {
      throw new Error('prepared ephemeral revision is not exact and legacy-free');
    }
    const activatedAt = now().toISOString();
    const nextActive = {
      pointerVersion: 1, deploymentId: this.deploymentId,
      generation: prepared.value.generation, manifestDigest: prepared.value.manifestDigest,
      activatedAt,
    };
    const transition = {
      transitionVersion: 1, mode: 'ephemeral_activation', operationRunId,
      preparedDigest: prepared.digest, manifestDigest: prepared.value.manifestDigest,
      nextActive,
    };
    if (existingTransition) {
      const stable = {
        ...transition, nextActive: {
          ...transition.nextActive, activatedAt: existingTransition.value.nextActive.activatedAt,
        },
      };
      if (!canonicalJson(existingTransition.value).equals(canonicalJson(stable))) {
        throw new Error('prepared ephemeral activation transition collision');
      }
    } else writeCreateOnly(transitionPath, canonicalJson(transition));
    const recorded = readCanonical(transitionPath).value;
    writeAtomic(this.activePath, canonicalJson(recorded.nextActive));
    unlinkSync(this.preparedPath);
    fsyncDirectory(this.root);
    return {
      active: recorded.nextActive, activeDigest: canonicalSha256(recorded.nextActive),
    };
  }

  resumePreparedRevision({ operationRunId, lockToken, expectedPreparedDigest, expectedDefinitionDigest, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    if (this.readPending()) throw new Error('a deployment revision is already pending');
    const prepared = readOptional(this.preparedPath);
    if (!prepared || prepared.digest !== expectedPreparedDigest) throw new Error('prepared revision compare-and-swap failed');
    const revision = this.readManifest(prepared.value.generation, { verifySnapshots: true });
    if (revision.manifestDigest !== prepared.value.manifestDigest
      || revision.manifest.definitionDigest !== expectedDefinitionDigest) {
      throw new Error('prepared revision definition does not match the requested deployment');
    }
    const activeDigest = this.readActive()?.value.manifestDigest ?? null;
    if (activeDigest !== prepared.value.priorActiveDigest) throw new Error('active revision changed before prepared resume');
    const timestamp = now().toISOString();
    const pending = {
      pointerVersion: 1, mode: 'deploy', deploymentId: this.deploymentId, operationRunId,
      generation: prepared.value.generation, manifestDigest: prepared.value.manifestDigest,
      priorActiveDigest: prepared.value.priorActiveDigest, stage: 'prepared', sequence: 0,
      createdAt: timestamp, updatedAt: timestamp,
    };
    writeCreateOnly(this.pendingPath, canonicalJson(pending));
    unlinkSync(this.preparedPath);
    fsyncDirectory(this.root);
    return { pending, pendingDigest: canonicalSha256(pending) };
  }

  beginRollback({ targetGeneration, expectedActiveDigest, operationRunId, lockToken, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    if (this.readPending()) throw new Error('a deployment revision is already pending');
    const active = this.readActive();
    if (!active || active.value.manifestDigest !== expectedActiveDigest) throw new Error('active revision compare-and-swap failed');
    const target = this.readManifest(targetGeneration, { verifySnapshots: true });
    const createdAt = now().toISOString();
    const pending = {
      pointerVersion: 1, mode: 'rollback', deploymentId: this.deploymentId, operationRunId,
      generation: targetGeneration, manifestDigest: target.manifestDigest, priorActiveDigest: expectedActiveDigest,
      stage: 'rollback_prepared', sequence: 0, createdAt, updatedAt: createdAt,
    };
    writeCreateOnly(this.pendingPath, canonicalJson(pending));
    return { pending, pendingDigest: canonicalSha256(pending) };
  }

  completeRollback({ operationRunId, lockToken, expectedPendingDigest, now = () => new Date() }) {
    this.assertLocked(lockToken, operationRunId);
    let pending = this.readPending();
    if (!pending || pending.digest !== expectedPendingDigest) throw new Error('pending revision compare-and-swap failed');
    if (pending.value.mode !== 'rollback' || !['rollback_health_verified', 'rollback_activating'].includes(pending.value.stage)) throw new Error('rollback is not health verified');
    if (pending.value.stage === 'rollback_health_verified') {
      const transitioned = this.transitionPending({ operationRunId, lockToken, expectedPendingDigest, nextStage: 'rollback_activating', now });
      pending = { value: transitioned.pending, digest: transitioned.pendingDigest };
    }
    const active = { pointerVersion: 1, deploymentId: this.deploymentId, generation: pending.value.generation, manifestDigest: pending.value.manifestDigest, activatedAt: now().toISOString() };
    const existing = this.readActive();
    if (!existing || ![pending.value.priorActiveDigest, pending.value.manifestDigest].includes(existing.value.manifestDigest)) throw new Error('active revision changed during rollback');
    if (existing.value.manifestDigest !== pending.value.manifestDigest) writeAtomic(this.activePath, canonicalJson(active));
    unlinkSync(this.pendingPath);
    fsyncDirectory(this.root);
    return { active, activeDigest: canonicalSha256(active) };
  }

  retireEphemeralRevision(options) {
    return retireActiveEphemeralRevision(this, options);
  }

  retireFailedEphemeralRevision(options) {
    return retireFailedEphemeralRevision(this, options);
  }

  readManifest(generation, { verifySnapshots = false } = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('generation must be a positive safe integer');
    const revisionRoot = path.join(this.revisions, String(generation));
    const { value: manifest, digest: manifestDigest } = readCanonical(path.join(revisionRoot, 'deployment-manifest.json'));
    validateArtifact(manifest);
    if (manifest.deploymentId !== this.deploymentId || manifest.generation !== generation) throw new Error('revision manifest identity mismatch');
    const {
      schemaVersion: _schemaVersion, artifactType: _artifactType, deploymentId: _deploymentId,
      generation: _generation, createdAt: _createdAt, priorActiveDigest: _priorActiveDigest,
      legacyResources: _legacyResources,
      ...definition
    } = manifest;
    if (canonicalSha256(withoutDigest(definition)) !== definition.definitionDigest) throw new Error('stored definition digest mismatch');
    if (verifySnapshots) for (const overlay of manifest.overlays) {
      const snapshotPath = path.join(revisionRoot, overlay.snapshotPath);
      if (sha256(readStableBytes(snapshotPath)) !== overlay.sha256) throw new Error(`revision snapshot digest mismatch: ${overlay.snapshotPath}`);
    }
    return { manifest, manifestDigest, revisionRoot };
  }

  readRetired() {
    if (!existsSync(this.retiredRevisions)) return [];
    return readdirSync(this.retiredRevisions, { withFileTypes: true }).map((entry) => {
      if (!entry.isFile() || !/^[1-9][0-9]*\.json$/.test(entry.name)) {
        throw new Error(`ambiguous retired revision entry: ${entry.name}`);
      }
      const record = readCanonical(path.join(this.retiredRevisions, entry.name));
      if (record.value.deploymentId !== this.deploymentId
          || record.value.generation !== Number(entry.name.slice(0, -5))) {
        throw new Error(`retired revision identity mismatch: ${entry.name}`);
      }
      return record;
    }).sort((left, right) => left.value.generation - right.value.generation);
  }

  inspect() {
    if (!existsSync(this.revisions)) return {
      deploymentId: this.deploymentId, registered: false,
      active: null, pending: null, prepared: null, retired: [],
    };
    const active = this.readActive();
    const pending = this.readPending();
    const prepared = readOptional(this.preparedPath);
    return {
      deploymentId: this.deploymentId, registered: true, active, pending, prepared,
      retired: this.readRetired(), nextGeneration: this.nextGeneration(),
    };
  }
}

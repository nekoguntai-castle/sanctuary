#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical-json.mjs';
import { writeExternalFileAtomic } from './safe-file.mjs';

function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('cleanup request arguments must be flag/value pairs');
    values[flag.slice(2)] = value;
  }
  return values;
}

function legacyFixtureRequested(values, authorityMode) {
  if (values['legacy-fixture-creation-witness'] === undefined) return false;
  if (values.mode !== 'run' || values['legacy-fixture-creation-witness'] !== 'true'
      || authorityMode !== 'deployment_managed_by_subject') {
    throw new Error('--legacy-fixture-creation-witness requires subject-managed run mode');
  }
  return true;
}

function upgradeTargetRequested(values, authorityMode) {
  const commit = values['upgrade-target-commit'];
  if (commit === undefined) return null;
  if (values.mode !== 'run' || authorityMode !== 'deployment_managed_by_subject'
      || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('--upgrade-target-commit requires subject-managed run mode and a full commit');
  }
  return commit;
}

function finishFields(values) {
  if (!['finish', 'recover'].includes(values.mode)) return {};
  if (!values.state || !/^(?:0|[1-9][0-9]{0,2})$/.test(values.status ?? '')) {
    throw new Error('finish requires --state and an integer --status');
  }
  return { statePath: path.resolve(values.state), subjectExitStatus: Number(values.status) };
}

function engineField(values) {
  if (!values.engine) return {};
  if (!['docker', 'podman', 'host'].includes(values.engine)) throw new Error('--engine is invalid');
  return { engine: values.engine };
}

export function writeCiCleanupRequest(values) {
  const required = ['mode', 'output', 'checkout-root', 'runtime', 'lane', 'artifact-dir'];
  for (const key of required) if (!values[key]) throw new Error(`--${key} is required`);
  if (!['prepare', 'finish', 'recover', 'run'].includes(values.mode)) throw new Error('--mode is invalid');
  const authorityMode = values['authority-mode'] ?? 'coordinator_managed';
  if (!['coordinator_managed', 'deployment_managed_by_subject'].includes(authorityMode)) {
    throw new Error('--authority-mode is invalid');
  }
  const request = {
    checkoutRoot: path.resolve(values['checkout-root']),
    runtimeDirectory: path.resolve(values.runtime),
    lane: values.lane,
    artifactDirectory: path.resolve(values['artifact-dir']),
    authorityMode,
    ...engineField(values),
  };
  if (legacyFixtureRequested(values, authorityMode)) request.legacyFixtureCreationWitness = true;
  const upgradeTargetCommit = upgradeTargetRequested(values, authorityMode);
  if (upgradeTargetCommit !== null) request.upgradeTargetCommit = upgradeTargetCommit;
  Object.assign(request, finishFields(values));
  const output = path.resolve(values.output);
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeExternalFileAtomic(output, canonicalJson(request), {
    checkoutRoot: request.checkoutRoot,
  });
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(writeCiCleanupRequest(parse(process.argv.slice(2)))); }
  catch (error) {
    process.stderr.write(`write-ci-cleanup-request: ${error.message}\n`);
    process.exitCode = 2;
  }
}

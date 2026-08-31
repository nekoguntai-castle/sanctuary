#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireProjectMutationLock, assertProjectMutationLock, releaseProjectMutationLock,
} from './project-lock.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function projectLock(command, project, token) {
  const runtimeDirectory = required('SANCTUARY_RUNTIME_DIR');
  const operationRunId = required('SANCTUARY_OPERATION_RUN_ID');
  if (command === 'acquire') {
    const controllerPid = Number(required('SANCTUARY_LOCK_CONTROLLER_PID'));
    const owner = acquireProjectMutationLock(runtimeDirectory, project, { operationRunId, controllerPid });
    process.stdout.write(`${owner.token}\n`);
    return;
  }
  if (!token) throw new Error(`${command} requires a lock token`);
  if (command === 'assert') assertProjectMutationLock(runtimeDirectory, project, token, operationRunId);
  else if (command === 'release') releaseProjectMutationLock(runtimeDirectory, project, token, operationRunId);
  else throw new Error('usage: project-lock-cli.mjs acquire|assert|release PROJECT [TOKEN]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { projectLock(...process.argv.slice(2)); } catch (error) {
    process.stderr.write(`project-lock-cli: ${error.message}\n`);
    process.exitCode = 1;
  }
}

import { replayOwnershipLabels } from './wallet-sync-replay-ownership.mjs';

const ENGINE_ID = /^[a-f0-9]{64}$/;

function ownedCreationListArgs(resourceClass, name) {
  const resourceCommand = resourceClass === 'compose_network'
    ? ['docker', 'network', 'ls', '--quiet', '--no-trunc', '--filter', `name=^${name}$`]
    : ['docker', 'container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', `name=^/${name}$`];
  const labels = replayOwnershipLabels(resourceClass);
  for (let index = 0; index < labels.length; index += 2) {
    resourceCommand.push('--filter', `label=${labels[index + 1]}`);
  }
  return resourceCommand;
}

function expectedOwnershipLabels(resourceClass) {
  const args = replayOwnershipLabels(resourceClass);
  return Object.fromEntries(args.flatMap((value, index) => (
    value === '--label' ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : []
  )));
}

function inspectCreatedIdentity(resourceClass, name, immutableIdentity, operation) {
  const args = resourceClass === 'compose_network'
    ? ['docker', 'network', 'inspect', immutableIdentity]
    : ['docker', 'container', 'inspect', immutableIdentity];
  let inspected;
  try {
    const value = JSON.parse(String(operation(args) ?? ''));
    if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid inspect result');
    [inspected] = value;
  } catch (error) {
    throw new Error(`Replay ${resourceClass} created identity is unavailable`, { cause: error });
  }
  const labels = resourceClass === 'compose_network' ? inspected.Labels : inspected.Config?.Labels;
  const expectedName = resourceClass === 'compose_network' ? name : `/${name}`;
  const expectedLabels = expectedOwnershipLabels(resourceClass);
  const labelsMatch = Object.entries(expectedLabels).every(([key, value]) => labels?.[key] === value);
  const stateIsValid = resourceClass === 'compose_network'
    || ['created', 'running', 'exited'].includes(inspected.State?.Status);
  if (inspected.Id !== immutableIdentity || inspected.Name !== expectedName || !labelsMatch || !stateIsValid) {
    throw new Error(`Replay ${resourceClass} recovery identity is ambiguous`);
  }
  return immutableIdentity;
}

function recoverCreatedIdentity(resourceClass, name, operation, createError) {
  let output;
  try {
    output = operation(ownedCreationListArgs(resourceClass, name));
  } catch (error) {
    throw new Error(`Replay ${resourceClass} recovery query failed`, { cause: error });
  }
  const matches = String(output ?? '').trim().split(/\s+/).filter(Boolean);
  if (matches.length === 0 && createError) throw createError;
  if (matches.length !== 1 || !ENGINE_ID.test(matches[0])) {
    throw new Error(`Replay ${resourceClass} recovery identity is ambiguous`);
  }
  return matches[0];
}

export function createRegisteredReplayResource(resourceClass, name, createArgs, runtime) {
  const { operation, onCreated } = runtime;
  let createOutput;
  let createError;
  try {
    createOutput = operation(createArgs);
  } catch (error) {
    createError = error;
  }
  const responseIdentity = String(createOutput ?? '').trim();
  const immutableIdentity = recoverCreatedIdentity(resourceClass, name, operation, createError);
  inspectCreatedIdentity(resourceClass, name, immutableIdentity, operation);
  onCreated(resourceClass, name, immutableIdentity);
  if (createError) throw createError;
  if (responseIdentity !== immutableIdentity) {
    throw new Error(`Replay ${resourceClass} create response disagrees with exact-name recovery`);
  }
  return immutableIdentity;
}

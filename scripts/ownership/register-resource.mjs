#!/usr/bin/env node
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { defaultOwnershipRoot, registerResource } from './registration.mjs';

const OPTIONS = new Set([
  'deployment-id', 'run-id', 'owner-id', 'class', 'lifecycle', 'policy',
  'release', 'commit', 'locator-kind', 'locator', 'identity', 'metadata-digest',
  'root', 'checkout-root', 'created-at', 'reference',
]);

function parseArgs(argv) {
  const result = { reference: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith('--') || !OPTIONS.has(flag.slice(2)) || argv[index + 1] === undefined) {
      throw new Error(`invalid registration option: ${flag ?? '<missing>'}`);
    }
    const key = flag.slice(2);
    if (key === 'reference') result.reference.push(argv[index + 1]);
    else if (result[key] !== undefined) throw new Error(`duplicate registration option: ${flag}`);
    else result[key] = argv[index + 1];
  }
  return result;
}

function required(options, key) {
  if (!options[key]) throw new Error(`--${key} is required`);
  return options[key];
}

export function run(argv) {
  const options = parseArgs(argv);
  const checkoutRoot = path.resolve(options['checkout-root'] ?? process.cwd());
  const metadataDigest = options['metadata-digest'] ?? canonicalSha256({ kind: options['locator-kind'], locator: options.locator });
  const { path: output } = registerResource({
    deploymentId: required(options, 'deployment-id'),
    operationRunId: required(options, 'run-id'),
    ownerId: required(options, 'owner-id'),
    resourceClass: required(options, 'class'),
    lifecycle: required(options, 'lifecycle'),
    cleanupPolicy: required(options, 'policy'),
    createdByRelease: required(options, 'release'),
    createdByCommit: required(options, 'commit'),
    locatorKind: required(options, 'locator-kind'),
    locator: required(options, 'locator'),
    immutableIdentity: required(options, 'identity'),
    metadataDigest,
    createdAt: options['created-at'],
    referenceIds: options.reference,
  }, { root: path.resolve(options.root ?? defaultOwnershipRoot()), checkoutRoot });
  process.stdout.write(`${output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { run(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`register-resource: ${error.message}\n`);
    process.exitCode = 1;
  }
}

import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const supportPackageModuleCandidates = Object.freeze([
  './dist/app/src/services/supportPackage',
  './dist/server/src/services/supportPackage',
  './dist/services/supportPackage',
]);

const requireFromCwd = createRequire(pathToFileURL(path.join(process.cwd(), '__support-package-runner__.mjs')).href);

export function resolveSupportPackageModulePath(
  resolveCandidate = (candidate) => requireFromCwd.resolve(candidate),
) {
  for (const candidate of supportPackageModuleCandidates) {
    try {
      resolveCandidate(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

export function loadSupportPackageGenerator({
  resolveCandidate = (candidate) => requireFromCwd.resolve(candidate),
  loadModule = (modulePath) => requireFromCwd(modulePath),
} = {}) {
  const modulePath = resolveSupportPackageModulePath(resolveCandidate);

  if (!modulePath) {
    throw new Error('could not locate compiled support package module');
  }

  const loadedModule = loadModule(modulePath);

  if (!loadedModule || typeof loadedModule.generateSupportPackage !== 'function') {
    throw new Error(`support package module '${modulePath}' does not export generateSupportPackage`);
  }

  return loadedModule.generateSupportPackage;
}

async function withSuppressedStdout(callback) {
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = (...args) => {
    const callbackArg = typeof args[args.length - 1] === 'function'
      ? args[args.length - 1]
      : null;
    if (callbackArg) {
      callbackArg();
    }
    return true;
  };

  try {
    return await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
}

/**
 * @param {NodeJS.WritableStream} [output]
 * @param {{ resolveCandidate?: (candidate: string) => string, loadModule?: (modulePath: string) => unknown }} [dependencies]
 */
export async function writeSupportPackageJson(
  output = process.stdout,
  dependencies = {},
) {
  const supportPackage = await withSuppressedStdout(async () => {
    const generateSupportPackage = loadSupportPackageGenerator(dependencies);
    return generateSupportPackage();
  });
  output.write(JSON.stringify(supportPackage, null, 2));
}

async function main() {
  try {
    await writeSupportPackageJson();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
const isStdinExecution = process.argv[1] === '-';

if (isDirectExecution || isStdinExecution) {
  await main();
}

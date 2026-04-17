import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, '..');
const repoRoot = resolve(serverRoot, '..');
const serverNodeModules = resolve(serverRoot, 'node_modules');
const repoNodeModules = resolve(repoRoot, 'node_modules');

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

if (pathExists(repoNodeModules)) {
  process.exit(0);
}

if (!existsSync(serverNodeModules)) {
  throw new Error(`Cannot resolve shared schema dependencies: ${serverNodeModules} does not exist`);
}

symlinkSync(serverNodeModules, repoNodeModules, process.platform === 'win32' ? 'junction' : 'dir');

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { config as loadEnvFile } from 'dotenv';

export function resolveRuntimeEnvFile(
  repoRoot,
  environment = process.env,
  homeDirectory = homedir(),
) {
  const runtimeDirectory = environment.SANCTUARY_RUNTIME_DIR
    || path.join(homeDirectory, '.config', 'sanctuary');
  const external = environment.SANCTUARY_ENV_FILE
    || path.join(runtimeDirectory, 'sanctuary.env');
  return [external, path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')]
    .find(candidate => existsSync(candidate));
}

export function loadRuntimeEnvironment(repoRoot) {
  const envFile = resolveRuntimeEnvFile(repoRoot);
  if (envFile) loadEnvFile({ path: envFile, override: false, quiet: true });
  return envFile;
}

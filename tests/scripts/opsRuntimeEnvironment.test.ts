import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadRuntimeEnvironment,
  resolveRuntimeEnvFile,
} from '../../scripts/ops/runtime-environment.mjs';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'sanctuary-runtime-env-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('operations runtime environment', () => {
  it('uses the same external, root, and legacy fallback precedence as start.sh', () => {
    const root = temporaryDirectory();
    const home = temporaryDirectory();
    const external = path.join(home, '.config', 'sanctuary', 'sanctuary.env');
    mkdirSync(path.dirname(external), { recursive: true });
    writeFileSync(path.join(root, '.env.local'), 'LOCAL_ONLY=1\n');
    writeFileSync(path.join(root, '.env'), 'ROOT_ENV=1\n');
    writeFileSync(external, 'EXTERNAL_ENV=1\n');

    expect(resolveRuntimeEnvFile(root, {}, home)).toBe(external);
    const customRuntime = temporaryDirectory();
    const customRuntimeEnv = path.join(customRuntime, 'sanctuary.env');
    writeFileSync(customRuntimeEnv, 'CUSTOM_RUNTIME=1\n');
    expect(resolveRuntimeEnvFile(root, { SANCTUARY_RUNTIME_DIR: customRuntime }, home))
      .toBe(customRuntimeEnv);
    expect(resolveRuntimeEnvFile(root, { SANCTUARY_ENV_FILE: '/missing' }, home))
      .toBe(path.join(root, '.env'));
  });

  it('loads the persisted Grafana credential without replacing explicit process values', () => {
    const root = temporaryDirectory();
    const envFile = path.join(root, 'runtime.env');
    const previousFile = process.env.SANCTUARY_ENV_FILE;
    const previousPassword = process.env.GRAFANA_PASSWORD;
    writeFileSync(envFile, 'GRAFANA_PASSWORD=persisted-secret\n');
    process.env.SANCTUARY_ENV_FILE = envFile;
    delete process.env.GRAFANA_PASSWORD;

    try {
      expect(loadRuntimeEnvironment(root)).toBe(envFile);
      expect(process.env.GRAFANA_PASSWORD).toBe('persisted-secret');
      process.env.GRAFANA_PASSWORD = 'explicit-secret';
      loadRuntimeEnvironment(root);
      expect(process.env.GRAFANA_PASSWORD).toBe('explicit-secret');
    } finally {
      if (previousFile === undefined) delete process.env.SANCTUARY_ENV_FILE;
      else process.env.SANCTUARY_ENV_FILE = previousFile;
      if (previousPassword === undefined) delete process.env.GRAFANA_PASSWORD;
      else process.env.GRAFANA_PASSWORD = previousPassword;
    }
  });
});

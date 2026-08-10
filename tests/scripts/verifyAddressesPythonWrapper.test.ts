import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pythonImpl } from '../../scripts/verify-addresses/implementations/python';
import { generateDerivationTestCases, TEST_SEEDS } from '../../scripts/verify-addresses/testCases';

const ORIGINAL_ENV = {
  PATH: process.env.PATH,
  VERIFY_ADDRESSES_PYTHON: process.env.VERIFY_ADDRESSES_PYTHON,
  VERIFY_ADDRESSES_PYTHON_IMAGE_ID: process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID,
  VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS: process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS,
  VERIFY_PYTHON_DOCKER_ARGS: process.env.VERIFY_PYTHON_DOCKER_ARGS,
  VERIFY_PYTHON_STUB_COUNTER: process.env.VERIFY_PYTHON_STUB_COUNTER,
  VERIFY_PYTHON_STUB_EMPTY_FAILS: process.env.VERIFY_PYTHON_STUB_EMPTY_FAILS,
  VERIFY_PYTHON_STUB_MODE: process.env.VERIFY_PYTHON_STUB_MODE,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writePythonStub(root: string): string {
  const stubPath = join(root, 'python-stub');
  writeFileSync(stubPath, `#!/usr/bin/env bash
set -euo pipefail

counter_file="\${VERIFY_PYTHON_STUB_COUNTER:?}"
count="$(cat "$counter_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$counter_file"

if [ "\${VERIFY_PYTHON_STUB_MODE:-batch}" = "json-error" ]; then
  printf '%s\\n' '{"error":"bad xpub"}'
  exit 1
fi

if [ "\${VERIFY_PYTHON_STUB_MODE:-batch}" = "missing-provenance" ]; then
  printf '%s\\n' '{"available":true,"version":"2.12.1","pythonVersion":"3.13.5","dependencyFingerprint":"fixture"}'
  exit 0
fi

if [ "$count" -le "\${VERIFY_PYTHON_STUB_EMPTY_FAILS:-0}" ]; then
  exit 1
fi

printf '%s\\n' '{"evidence":[{"caseId":"fixture","implementation":"bip_utils (Python)","implementationVersion":"2.12.1","accountKeys":[],"address":"fixture-address","scriptPubKeyHex":"0014"}]}'
`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

describe('verify-addresses Python wrapper', () => {
  const testCase = { ...generateDerivationTestCases()[0], id: 'fixture' };
  afterEach(() => {
    restoreEnv();
  });

  it('retries an empty Python subprocess failure before accepting a valid result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-python-wrapper-'));
    try {
      const counterPath = join(root, 'counter');
      writeFileSync(counterPath, '0');
      process.env.VERIFY_ADDRESSES_PYTHON = writePythonStub(root);
      process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS = '2';
      process.env.VERIFY_PYTHON_STUB_COUNTER = counterPath;
      process.env.VERIFY_PYTHON_STUB_EMPTY_FAILS = '1';

      await expect(
        pythonImpl.deriveCases([testCase], TEST_SEEDS)
      ).resolves.toHaveLength(1);
      expect(readFileSync(counterPath, 'utf8').trim()).toBe('2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not retry structured Python calculation errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-python-wrapper-'));
    try {
      const counterPath = join(root, 'counter');
      writeFileSync(counterPath, '0');
      process.env.VERIFY_ADDRESSES_PYTHON = writePythonStub(root);
      process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS = '3';
      process.env.VERIFY_PYTHON_STUB_COUNTER = counterPath;
      process.env.VERIFY_PYTHON_STUB_MODE = 'json-error';

      await expect(
        pythonImpl.deriveCases([testCase], TEST_SEEDS)
      ).rejects.toThrow('bad xpub');
      expect(readFileSync(counterPath, 'utf8').trim()).toBe('1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks an available Python verifier unavailable when source provenance is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-python-wrapper-'));
    try {
      const counterPath = join(root, 'counter');
      writeFileSync(counterPath, '0');
      process.env.VERIFY_ADDRESSES_PYTHON = writePythonStub(root);
      process.env.VERIFY_PYTHON_STUB_COUNTER = counterPath;
      process.env.VERIFY_PYTHON_STUB_MODE = 'missing-provenance';

      await expect(pythonImpl.isAvailable()).resolves.toBe(false);
      expect(pythonImpl.unavailableReason).toContain('omitted required runtime provenance');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects configured Python commands with shell arguments', async () => {
    process.env.VERIFY_ADDRESSES_PYTHON = 'python3 -c';

    await expect(
      pythonImpl.deriveCases([testCase], TEST_SEEDS)
    ).rejects.toThrow('VERIFY_ADDRESSES_PYTHON must be a single executable path or command name');
  });

  it('fails closed when the locked Python image identity is absent or changed', async () => {
    delete process.env.VERIFY_ADDRESSES_PYTHON;
    delete process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID;
    await expect(pythonImpl.deriveCases([testCase], TEST_SEEDS))
      .rejects.toThrow('VERIFY_ADDRESSES_PYTHON_IMAGE_ID must be an immutable sha256 image ID');
    process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = 'sanctuary/verify-addresses-python:changed';
    await expect(pythonImpl.deriveCases([testCase], TEST_SEEDS))
      .rejects.toThrow('VERIFY_ADDRESSES_PYTHON_IMAGE_ID must be an immutable sha256 image ID');
  });

  it('runs the locked Python image without network access or host path dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-python-docker-wrapper-'));
    try {
      const dockerPath = join(root, 'docker');
      const argsPath = join(root, 'docker-args');
      writeFileSync(dockerPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "\${VERIFY_PYTHON_DOCKER_ARGS:?}"
test "$1" = run
test "$2" = --rm
test "$3" = --network
test "$4" = none
test "$5" = -i
test "$6" = sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
test "$7" = batch
test "$#" = 7
test -n "$(cat)"
printf '%s\\n' '{"evidence":[{"caseId":"fixture","implementation":"bip_utils (Python)","implementationVersion":"2.12.1","accountKeys":[],"address":"fixture-address","scriptPubKeyHex":"0014"}]}'
`);
      chmodSync(dockerPath, 0o755);
      delete process.env.VERIFY_ADDRESSES_PYTHON;
      process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
      process.env.VERIFY_PYTHON_DOCKER_ARGS = argsPath;
      process.env.PATH = `${root}:${process.env.PATH}`;

      await expect(pythonImpl.deriveCases([testCase], TEST_SEEDS)).resolves.toHaveLength(1);
      expect(readFileSync(argsPath, 'utf8').trim().split('\n')).toEqual([
        'run', '--rm', '--network', 'none', '-i',
        `sha256:${'b'.repeat(64)}`, 'batch',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

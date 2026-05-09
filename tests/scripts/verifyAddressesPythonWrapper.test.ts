import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pythonImpl } from '../../scripts/verify-addresses/implementations/python';

const ORIGINAL_ENV = {
  VERIFY_ADDRESSES_PYTHON: process.env.VERIFY_ADDRESSES_PYTHON,
  VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS: process.env.VERIFY_ADDRESSES_PYTHON_RUN_ATTEMPTS,
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

if [ "\${VERIFY_PYTHON_STUB_MODE:-address}" = "json-error" ]; then
  printf '%s\\n' '{"error":"bad xpub"}'
  exit 1
fi

if [ "$count" -le "\${VERIFY_PYTHON_STUB_EMPTY_FAILS:-0}" ]; then
  exit 1
fi

printf '%s\\n' '{"address":"2N4SanctuaryFixtureAddress"}'
`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

describe('verify-addresses Python wrapper', () => {
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
        pythonImpl.deriveMultisig(['xpub-fixture'], 1, 0, 'p2wsh', false, 'testnet')
      ).resolves.toBe('2N4SanctuaryFixtureAddress');
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
        pythonImpl.deriveMultisig(['xpub-fixture'], 1, 0, 'p2wsh', false, 'testnet')
      ).rejects.toThrow('bad xpub');
      expect(readFileSync(counterPath, 'utf8').trim()).toBe('1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects configured Python commands with shell arguments', async () => {
    process.env.VERIFY_ADDRESSES_PYTHON = 'python3 -c';

    await expect(
      pythonImpl.deriveMultisig(['xpub-fixture'], 1, 0, 'p2wsh', false, 'testnet')
    ).rejects.toThrow('VERIFY_ADDRESSES_PYTHON must be a single executable path or command name');
  });
});

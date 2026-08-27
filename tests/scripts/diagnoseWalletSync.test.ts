/**
 * Non-regression tests for `scripts/diagnose-wallet-sync.sh`.
 *
 * On 2026-08-20 this script was run during a live incident and printed:
 *
 *   ===== H. redis: deduplication keys =====
 *   (none — no wallet is dedup-blocked)
 *   ===== I. redis: wallet sync locks =====
 *   (none held)
 *   ===== J. worker logs (last 2h) =====
 *   (none matched)
 *
 * ...having reached nothing at all — every `docker compose` call had failed on
 * unresolved environment variables. It then exited 0 and ended with "Done."
 * Those clean-looking negatives rule out the "a live lock is pinning the sync"
 * hypothesis, which is precisely the hypothesis that was true, and point the
 * operator at a Postgres rollback that never happened.
 *
 * A second defect survived the environment fix: `docker compose exec -T`
 * consumes stdin, so a `while read` loop feeding it a key list is drained after
 * the first key. A box holding three locks reported one.
 *
 * These tests execute the real script against a stubbed `docker` on PATH.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/diagnose-wallet-sync.sh');

/** Strings that assert a clean box. None may appear when nothing was reached. */
const CLEAN_LOOKING_NEGATIVES = [
  '(none held)',
  '(none — no wallet is dedup-blocked)',
  '(none matched)',
];

let workdir: string;

function installDockerStub(body: string): void {
  const stub = join(workdir, 'docker');
  writeFileSync(stub, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(stub, 0o755);
}

function installCommandStub(name: string, body: string): void {
  const stub = join(workdir, name);
  writeFileSync(stub, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(stub, 0o755);
}

function runScript(environment: Record<string, string> = {}): { status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT], {
      env: {
        ...process.env,
        PATH: `${workdir}:${process.env.PATH ?? ''}`,
        SANCTUARY_DIAGNOSE_LOCK_SETTLE_SECONDS: '0',
        SANCTUARY_DIAGNOSE_SKIP_ENV: '1',
        ...environment,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'diagnose-wallet-sync-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('diagnose-wallet-sync.sh when nothing is reachable', () => {
  beforeEach(() => {
    // Stands in for compose failing on unresolved ${VAR:?} interpolation.
    installDockerStub([
      'cat >/dev/null 2>&1 || true',
      'echo "error while interpolating services.backend.environment.X" >&2',
      'exit 1',
    ].join('\n'));
  });

  it('exits non-zero rather than reporting a healthy run', () => {
    expect(runScript().status).not.toBe(0);
  });

  it.each(CLEAN_LOOKING_NEGATIVES)('never prints %j', (negative) => {
    expect(runScript().output).not.toContain(negative);
  });

  it('says explicitly that it could not query', () => {
    expect(runScript().output).toMatch(/UNREACHABLE/);
  });
});

describe('diagnose-wallet-sync.sh SQL quoting', () => {
  beforeEach(() => {
    // Echo whatever SQL is piped in, so the emitted text can be asserted.
    installDockerStub([
      'sql="$(cat)"',
      'case "$*" in',
      '  *psql*) printf "SQL>>%s<<SQL\\n" "$sql" ;;',
      '  *) : ;;',
      'esac',
      'exit 0',
    ].join('\n'));
  });

  it('emits string literals with their quotes intact', () => {
    const { output } = runScript();
    // The 2026-08-20 failure mode: `psql -c '... ''x'' ...'` collapses to bare
    // x, and psql reports `column "resyncing" does not exist`.
    expect(output).toContain("'resyncing'");
    expect(output).toContain("'retrying'");
    expect(output).toContain("'success'");
    expect(output).toContain("interval '1 hour'");
    expect(output).not.toMatch(/IN \(resyncing,\s*retrying\)/);
    expect(output).not.toMatch(/=\s*success\s+AND/);
    expect(output).not.toMatch(/interval 1 hour/);
  });

  it('preserves double-quoted identifiers', () => {
    expect(runScript().output).toContain('"lastSyncStatus"');
  });
});

describe('diagnose-wallet-sync.sh when redis is reachable', () => {
  beforeEach(() => {
    // `docker compose exec -T` attaches stdin; a stub that does not drain it
    // would hide the very bug these tests pin.
    installDockerStub([
      'cat >/dev/null 2>&1 || true',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --scan) scan=1 ;;',
      '    PTTL) pttl=1 ;;',
      '  esac',
      'done',
      'if [ -n "${scan:-}" ]; then',
      '  case "$*" in',
      '    *lock*sync:wallet*)',
      '      echo "lock:sync:wallet:aaaaaaaa"',
      '      echo "lock:sync:wallet:bbbbbbbb"',
      '      echo "lock:sync:wallet:cccccccc"',
      '      ;;',
      '    *) : ;;',
      '  esac',
      '  exit 0',
      'fi',
      'if [ -n "${pttl:-}" ]; then echo 1500000; exit 0; fi',
      'exit 0',
    ].join('\n'));
  });

  it('reports every lock, not just the first the scan returned', () => {
    const { output } = runScript();
    expect(output.match(/lock:<redacted_lock>/g)).toHaveLength(3);
    expect(output).not.toContain('lock:sync:wallet:aaaaaaaa');
    expect(output).not.toContain('lock:sync:wallet:bbbbbbbb');
    expect(output).not.toContain('lock:sync:wallet:cccccccc');
  });
});

describe('diagnose-wallet-sync.sh privacy and worker snapshot', () => {
  const walletId = '123e4567-e89b-42d3-a456-426614174000';
  const otherWalletId = '123e4567-e89b-42d3-a456-426614174001';
  const rawJob = 'opaque-private-job-123';
  const bech32Address = 'bc1q23456789acdef';
  const base58Address = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  const onionEndpoint = 'hiddenserviceexample.onion:9050';

  beforeEach(() => {
    installDockerStub([
      'sql="$(cat)"',
      'case "$*" in',
      '  *psql*)',
      `    echo "${walletId} https://private.example ${'a'.repeat(64)} ${bech32Address} ${base58Address} ${onionEndpoint}"`,
      `    echo "${otherWalletId}"`,
      '    ;;',
      '  *workerDiagnosticsCli.js*)',
      '    echo \"{\\\"schemaVersion\\\":1,\\\"status\\\":\\\"observed\\\",\\\"walletSyncExecution\\\":{\\\"version\\\":2,\\\"observation\\\":\\\"observed\\\"}}\"',
      '    ;;',
      '  *"--scan"*"de:"*)',
      `    echo "sanctuary:worker:sync:de:full-resync:${walletId}"`,
      '    ;;',
      '  *"--scan"*"lock"*)',
      `    echo "lock:sync:wallet:${walletId}"`,
      '    ;;',
      '  *" GET "*)',
      `    echo "${rawJob}"`,
      '    ;;',
      '  *" PTTL "*) echo 1500000 ;;',
      '  *logs*)',
      `    echo 'worker | {"event":"stage_started","walletId":"${walletId}","message":"private-wallet https://private.example"}'`,
      `    echo 'lookup internal-host.example on 10.0.0.2 for ${walletId}'`,
      `    echo 'timeout contacting NASBOX descriptor-secret for ${walletId}'`,
      '    ;;',
      '  *) echo 0 ;;',
      'esac',
      'exit 0',
    ].join('\n'));
  });

  it('uses stable per-report wallet references and removes other sensitive identities', () => {
    const { status, output } = runScript();

    expect(status).toBe(0);
    expect(output).toContain('wallet_ref_001');
    expect(output.match(/wallet_ref_001/g)?.length).toBeGreaterThan(1);
    expect(output).toContain('wallet_ref_002');
    expect(output).not.toMatch(new RegExp(`${walletId}|${otherWalletId}`));
    expect(output).not.toContain(rawJob);
    expect(output).not.toContain('private-wallet');
    expect(output).not.toContain('private.example');
    expect(output).not.toContain('internal-host.example');
    expect(output).not.toContain('10.0.0.2');
    expect(output).not.toContain('NASBOX');
    expect(output).not.toContain('descriptor-secret');
    expect(output).toContain('event=stage_started');
    expect(output).toContain('event=timeout');
    expect(output).not.toContain('a'.repeat(64));
    expect(output).not.toMatch(new RegExp(`${bech32Address}|${base58Address}|${onionEndpoint}`));
    expect(output).toContain('<redacted_endpoint>');
    expect(output).toContain('<redacted_hash>');
    expect(output).toContain('<redacted_address>');
  });

  it('preserves the privacy boundary when awk interval expressions are unavailable', () => {
    installCommandStub('awk', 'exec /usr/bin/awk -W traditional "$@"');

    const { status, output } = runScript();

    expect(status).toBe(0);
    expect(output).toContain('wallet_ref_001');
    expect(output).toContain('wallet_ref_002');
    expect(output).not.toMatch(new RegExp(`${walletId}|${otherWalletId}`));
    expect(output).not.toContain('private.example');
    expect(output).not.toContain('10.0.0.2');
    expect(output).not.toContain('a'.repeat(64));
    expect(output).not.toMatch(new RegExp(`${bech32Address}|${base58Address}|${onionEndpoint}`));
    expect(output).toContain('<redacted_endpoint>');
    expect(output).toContain('<redacted_hash>');
    expect(output).toContain('<redacted_address>');
  });

  it('exposes raw identities only under the exact opt-in and marks both report edges', () => {
    const { output } = runScript({ SANCTUARY_DIAGNOSE_INCLUDE_IDENTIFIERS: '1' });

    expect(output).toContain(walletId);
    expect(output).toContain(rawJob);
    expect(output.match(/NON-SHAREABLE: RAW IDENTIFIERS INCLUDED/g)).toHaveLength(2);
  });

  it('does not enable raw mode for truthy-looking values other than one', () => {
    const { output } = runScript({ SANCTUARY_DIAGNOSE_INCLUDE_IDENTIFIERS: 'true' });
    expect(output).not.toContain(walletId);
    expect(output).not.toContain('NON-SHAREABLE');
  });

  it('queries all generation, lease, retry, and action-required fields', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toContain('"requestedIncrementalSyncGeneration"');
    expect(source).toContain('"claimedIncrementalSyncGeneration"');
    expect(source).toContain('"processedIncrementalSyncGeneration"');
    expect(source).toContain('"preparedFullResyncGeneration"');
    expect(source).toContain('"incrementalSyncLeaseExpiresAt"');
    expect(source).toContain('"syncRetryCount"');
    expect(source).toContain('"syncActionRequiredAt"');
  });
});

describe.each([
  { label: 'unsupported', exit: 2 },
  { label: 'timeout', exit: 3 },
  { label: 'unavailable', exit: 4 },
])('diagnostics CLI $label classification', ({ label, exit }) => {
  beforeEach(() => {
    installDockerStub([
      'cat >/dev/null 2>&1 || true',
      'case "$*" in',
      `  *workerDiagnosticsCli.js*) echo '{"schemaVersion":1,"status":"${label}"}'; exit ${exit} ;;`,
      '  *logs*) exit 0 ;;',
      '  *"--scan"*) exit 0 ;;',
      '  *redis-cli*) echo 0; exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'));
  });

  it('is explicit and makes the report incomplete', () => {
    const { status, output } = runScript();
    expect(status).not.toBe(0);
    expect(output).toContain(`"status":"${label}"`);
    expect(output).toContain('UNREACHABLE — could not query: F');
    expect(output).toContain('INCOMPLETE');
  });
});

describe('diagnostic report boundary failures', () => {
  it('fails closed when per-key Redis evidence cannot be read', () => {
    installDockerStub([
      'cat >/dev/null 2>&1 || true',
      'case "$*" in',
      '  *psql*) exit 0 ;;',
      '  *workerDiagnosticsCli.js*) echo \'{"schemaVersion":1,"status":"observed","walletSyncExecution":{}}\'; exit 0 ;;',
      '  *"--scan"*"de:"*) echo "private-dedup-key"; exit 0 ;;',
      '  *"--scan"*"lock"*) echo "private-lock-key"; exit 0 ;;',
      '  *" TTL "*) echo "redis TTL failure on NASBOX" >&2; exit 7 ;;',
      '  *" PTTL "*) echo "redis PTTL failure on NASBOX" >&2; exit 8 ;;',
      '  *logs*) exit 0 ;;',
      '  *redis-cli*) echo 0; exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'));

    const { status, output } = runScript();
    expect(status).not.toBe(0);
    expect(output).toContain('UNREACHABLE — could not query: H:dedup-detail');
    expect(output).toContain('UNREACHABLE — could not query: I:lock-detail');
    expect(output).not.toMatch(/redis (TTL|PTTL) failure|NASBOX/);
    expect(output).not.toContain('-> decaying');
    expect(output).not.toContain('Done — every section queried successfully.');
  });

  it('fails closed when the pseudonymizer cannot run', () => {
    installDockerStub('cat >/dev/null 2>&1 || true; exit 0');
    installCommandStub('awk', 'exit 9');

    const { status, output } = runScript();
    expect(status).not.toBe(0);
    expect(output).toContain('pseudonymization boundary failed');
    expect(output).not.toContain('Done — every section queried successfully.');
  });

  it('marks a missing backend diagnostics command as unreachable', () => {
    installDockerStub([
      'cat >/dev/null 2>&1 || true',
      'case "$*" in',
      '  *workerDiagnosticsCli.js*) echo "dial tcp [fd00::5]:50002 on NASBOX: descriptor-secret" >&2; exit 1 ;;',
      '  *logs*) exit 0 ;;',
      '  *"--scan"*) exit 0 ;;',
      '  *redis-cli*) echo 0; exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'));

    const { status, output } = runScript();
    expect(status).not.toBe(0);
    expect(output).toContain('UNREACHABLE — could not query: F');
    expect(output).toContain('INCOMPLETE');
    expect(output).toContain('command error detail redacted');
    expect(output).not.toMatch(/fd00::5|NASBOX|descriptor-secret/);
  });
});

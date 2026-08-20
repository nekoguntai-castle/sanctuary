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
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function runScript(): { status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT], {
      env: {
        ...process.env,
        PATH: `${workdir}:${process.env.PATH ?? ''}`,
        SANCTUARY_DIAGNOSE_LOCK_SETTLE_SECONDS: '0',
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
    expect(output).toContain('lock:sync:wallet:aaaaaaaa');
    expect(output).toContain('lock:sync:wallet:bbbbbbbb');
    expect(output).toContain('lock:sync:wallet:cccccccc');
  });
});

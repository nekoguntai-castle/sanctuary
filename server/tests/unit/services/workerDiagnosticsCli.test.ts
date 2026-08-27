import { describe, expect, it, vi } from 'vitest';
import {
  runWorkerDiagnosticsCli,
  WORKER_DIAGNOSTICS_CLI_EXIT,
} from '../../../src/services/workerDiagnosticsCli';
import { runWorkerDiagnosticsCliEntrypoint } from '../../../src/workerDiagnosticsCli';

function io() {
  return { stdout: vi.fn(), stderr: vi.fn() };
}

describe('worker diagnostics CLI', () => {
  it('prints only the classified wallet execution aggregate', async () => {
    const streams = io();
    const request = vi.fn().mockResolvedValue({
      status: 'observed',
      value: {
        protocolVersion: 1,
        sampledAt: '2026-08-26T00:00:00.000Z',
        privateNotificationDetail: 'must-not-print',
      },
      walletSyncExecution: {
        status: 'observed',
        value: {
          version: 2,
          observation: 'observed',
          scope: 'sampled_worker',
          active: { total: '1' },
        },
      },
    });

    await expect(runWorkerDiagnosticsCli([], streams, request)).resolves.toBe(0);
    expect(streams.stdout).toHaveBeenCalledOnce();
    const output = streams.stdout.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      status: 'observed',
      walletSyncExecution: {
        version: 2,
        observation: 'observed',
        scope: 'sampled_worker',
        active: { total: '1' },
      },
    });
    expect(output).not.toContain('must-not-print');
    expect(streams.stderr).not.toHaveBeenCalled();
  });

  it('classifies normalized execution-unsupported independently of transport reachability', async () => {
    const streams = io();
    const request = vi.fn().mockResolvedValue({
      status: 'observed',
      value: { protocolVersion: 1 },
      walletSyncExecution: { status: 'unsupported' },
    });

    await expect(runWorkerDiagnosticsCli([], streams, request)).resolves.toBe(
      WORKER_DIAGNOSTICS_CLI_EXIT.unsupported,
    );
    expect(streams.stdout).toHaveBeenCalledWith('{"schemaVersion":1,"status":"unsupported"}');
  });

  it.each([
    ['unsupported', WORKER_DIAGNOSTICS_CLI_EXIT.unsupported],
    ['timeout', WORKER_DIAGNOSTICS_CLI_EXIT.timeout],
    ['unavailable', WORKER_DIAGNOSTICS_CLI_EXIT.unavailable],
  ] as const)('uses a bounded exit for %s without exposing secrets', async (status, exitCode) => {
    const streams = io();
    const request = vi.fn().mockResolvedValue({ status });

    await expect(runWorkerDiagnosticsCli([], streams, request)).resolves.toBe(exitCode);
    expect(streams.stdout).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, status }));
    expect(streams.stderr).not.toHaveBeenCalled();
  });

  it('rejects arguments and exceptions without echoing their contents', async () => {
    const argumentStreams = io();
    const request = vi.fn();
    await expect(runWorkerDiagnosticsCli(
      ['secret-url=https://private.example'],
      argumentStreams,
      request,
    )).resolves.toBe(WORKER_DIAGNOSTICS_CLI_EXIT.error);
    expect(argumentStreams.stderr.mock.calls.join('\n')).not.toContain('private.example');
    expect(request).not.toHaveBeenCalled();

    const failureStreams = io();
    const failingRequest = vi.fn().mockRejectedValue(new Error('secret-token private.example'));
    await expect(runWorkerDiagnosticsCli([], failureStreams, failingRequest)).resolves.toBe(
      WORKER_DIAGNOSTICS_CLI_EXIT.error,
    );
    expect(failureStreams.stderr.mock.calls.join('\n')).not.toMatch(/secret-token|private\.example/);
  });

  it('uses the supported process streams when no I/O adapter is supplied', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runWorkerDiagnosticsCli()).resolves.toBe(
      WORKER_DIAGNOSTICS_CLI_EXIT.unavailable,
    );
    await expect(runWorkerDiagnosticsCli(['unexpected'])).resolves.toBe(
      WORKER_DIAGNOSTICS_CLI_EXIT.error,
    );
    expect(stdout).toHaveBeenCalledWith('{"schemaVersion":1,"status":"unavailable"}\n');
    expect(stderr).toHaveBeenCalledWith(
      'Worker diagnostics failed: this command accepts no arguments.\n',
    );
  });

  it('runs the built entrypoint only as main and bounds unexpected rejection', async () => {
    const previousExitCode = process.exitCode;
    const writeError = vi.fn();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runWorkerDiagnosticsCliEntrypoint(false, vi.fn(), writeError);
      expect(writeError).not.toHaveBeenCalled();

      await runWorkerDiagnosticsCliEntrypoint(
        true,
        vi.fn().mockResolvedValue(WORKER_DIAGNOSTICS_CLI_EXIT.timeout),
        writeError,
      );
      expect(process.exitCode).toBe(WORKER_DIAGNOSTICS_CLI_EXIT.timeout);

      await runWorkerDiagnosticsCliEntrypoint(
        true,
        vi.fn().mockRejectedValue(new Error('private failure')),
      );
      expect(process.exitCode).toBe(WORKER_DIAGNOSTICS_CLI_EXIT.error);
      expect(stderr).toHaveBeenCalledWith('Worker diagnostics failed unexpectedly.\n');
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

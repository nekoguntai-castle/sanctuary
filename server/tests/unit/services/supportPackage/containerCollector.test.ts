import { describe, it, expect, vi, beforeEach } from 'vitest';

const { collectorMap } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

import '../../../../src/services/supportPackage/collectors/container';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  const generatedAt = new Date();
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt,
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
  } satisfies CollectorContext;
}

/**
 * promisify wraps the callback-based function, so we simulate the callback style.
 */
function mockPsOutput(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
      cb(null, { stdout });
    }
  );
}

function mockPsError(message: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error(message));
    }
  );
}

describe('container collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('container');
    if (!c) throw new Error('container collector not registered');
    return c;
  };

  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('registers itself as container', () => {
    expect(collectorMap.has('container')).toBe(true);
  });

  it('reports healthy container with dumb-init and no zombies', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    1     0 S dumb-init',
        '    7     1 S node',
        '   20     7 S node',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.totalProcesses).toBe(3);
    expect(result.zombies).toEqual([]);
    expect(result.pid1).toEqual({ command: 'dumb-init', state: 'S' });
    expect(result.hasDumbInit).toBe(true);
  });

  it('detects zombie processes', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    1     0 S node',
        '   10     1 Z wget',
        '   11     1 Z ssl_client',
        '   12     1 S node',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.totalProcesses).toBe(4);
    expect(result.zombies).toEqual([
      { pid: 10, ppid: 1, command: 'wget' },
      { pid: 11, ppid: 1, command: 'ssl_client' },
    ]);
    expect(result.hasDumbInit).toBe(false);
    expect(result.pid1).toEqual({ command: 'node', state: 'S' });
  });

  it('reports hasDumbInit false when PID 1 is not dumb-init', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    1     0 S node',
        '    7     1 S node',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.hasDumbInit).toBe(false);
  });

  it('handles pid1 not found in ps output', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    7     1 S node',
        '   20     7 S node',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.pid1).toBeNull();
    expect(result.hasDumbInit).toBe(false);
  });

  it('handles empty ps output (header only)', async () => {
    mockPsOutput('  PID  PPID S COMMAND\n');

    const result = await getCollector()(makeContext());
    expect(result.totalProcesses).toBe(0);
    expect(result.zombies).toEqual([]);
    expect(result.pid1).toBeNull();
  });

  it('handles commands with spaces', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    1     0 S dumb-init',
        '    7     1 S node dist/app/src/index.js',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.totalProcesses).toBe(2);
  });

  it('throws when ps command fails (runner handles the error)', async () => {
    mockPsError('spawn ps ENOENT');

    await expect(getCollector()(makeContext())).rejects.toThrow('spawn ps ENOENT');
  });

  it('handles malformed ps output lines gracefully', async () => {
    mockPsOutput(
      [
        '  PID  PPID S COMMAND',
        '    1     0 S dumb-init',
        '  bad',
        '    7     1 S node',
      ].join('\n')
    );

    const result = await getCollector()(makeContext());
    expect(result.totalProcesses).toBe(2);
  });
});

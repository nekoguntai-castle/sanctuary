import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';
import { withSerializableConflictRetry } from '../../../src/utils/prismaSerializableConflict';

const conflict = () => new Prisma.PrismaClientKnownRequestError('conflict', {
  code: 'P2034', clientVersion: 'test',
});
const exhausted = (error: unknown) => Object.assign(new Error('exhausted'), { last: error });

describe('withSerializableConflictRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the first successful attempt without waiting', async () => {
    const operation = vi.fn(async () => 'done');
    await expect(withSerializableConflictRetry(operation, { onExhausted: exhausted })).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(1);
  });

  it('backs off before replaying a conflicted attempt', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue('replayed');
    const pending = withSerializableConflictRetry(operation, { onExhausted: exhausted });
    await vi.advanceTimersByTimeAsync(0);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe('replayed');
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it('rethrows a non-conflict error immediately and unchanged', async () => {
    const failure = new Error('not a conflict');
    const operation = vi.fn(async () => { throw failure; });
    const onExhausted = vi.fn(exhausted);
    await expect(withSerializableConflictRetry(operation, { onExhausted })).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('throws the onExhausted result with the last conflict after every attempt conflicts', async () => {
    const conflicts = [conflict(), conflict()];
    const operation = vi.fn()
      .mockRejectedValueOnce(conflicts[0])
      .mockRejectedValueOnce(conflicts[1]);
    const pending = withSerializableConflictRetry(operation, { maxAttempts: 2, onExhausted: exhausted });
    const outcome = expect(pending).rejects.toMatchObject({ message: 'exhausted', last: conflicts[1] });
    await vi.advanceTimersByTimeAsync(200);
    await outcome;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('can rethrow the original conflict on exhaustion', async () => {
    const last = conflict();
    const operation = vi.fn().mockRejectedValue(last);
    const pending = withSerializableConflictRetry(operation, { onExhausted: error => error });
    const outcome = expect(pending).rejects.toBe(last);
    await vi.advanceTimersByTimeAsync(200);
    await outcome;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('reports each replayed conflict to onRetry before backing off', async () => {
    const first = conflict();
    const operation = vi.fn().mockRejectedValueOnce(first).mockResolvedValue('ok');
    const onRetry = vi.fn();
    const pending = withSerializableConflictRetry(operation, { onExhausted: exhausted, onRetry });
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe('ok');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, first);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid attempt bound %s', async maxAttempts => {
    await expect(withSerializableConflictRetry(async () => 'x', { maxAttempts, onExhausted: exhausted }))
      .rejects.toThrow(TypeError);
  });
});

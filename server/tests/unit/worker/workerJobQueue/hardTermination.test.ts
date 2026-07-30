import { describe, expect, it, vi } from 'vitest';

import { hardTerminateProcess } from '../../../../src/worker/workerJobQueue/hardTermination';

describe('hardTerminateProcess', () => {
  it('exits the worker synchronously with the requested failure code', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((exitCode) => {
      throw new Error(`process exited with ${String(exitCode)}`);
    });

    expect(() => hardTerminateProcess(1)).toThrow('process exited with 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

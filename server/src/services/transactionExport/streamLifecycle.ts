import type { Request, Response } from 'express';

export class ExportStreamClosedError extends Error {
  constructor(message = 'Transaction export stream closed') {
    super(message);
    this.name = 'ExportStreamClosedError';
  }
}

export interface ExportStreamLifecycle {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * Retains bounded export ownership until uncancellable database/file operations
 * settle, preventing client aborts from bypassing the process concurrency cap.
 */
export class ExportOperationOwnership {
  private readonly pending = new Set<Promise<void>>();

  hold<T>(operation: Promise<T>): Promise<T> {
    let settlement!: Promise<void>;
    settlement = operation.then(
      () => this.pending.delete(settlement),
      () => this.pending.delete(settlement),
    ).then(() => undefined);
    this.pending.add(settlement);
    return operation;
  }

  releaseWhenSettled(release: () => void): void {
    const pending = [...this.pending];
    if (pending.length === 0) {
      release();
      return;
    }
    void Promise.all(pending).then(() => this.releaseWhenSettled(release));
  }
}

export async function raceExportAbort<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => settle(() => reject(signal.reason));
    const settle = (callback: () => void) => {
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => settle(() => resolve(value)),
      error => settle(() => reject(error)),
    );
  });
}

export function observeExportStream(req: Request, res: Response): ExportStreamLifecycle {
  const controller = new AbortController();
  const abort = () => controller.abort(new ExportStreamClosedError());
  const abortWithError = (error: Error) => controller.abort(error);
  const requestSignal = req.requestAbortSignal;
  const abortForRequestSignal = () => controller.abort(
    requestSignal?.reason instanceof Error
      ? requestSignal.reason
      : new ExportStreamClosedError('Transaction export request aborted'),
  );
  req.once('aborted', abort);
  res.once('close', abort);
  res.once('error', abortWithError);
  if (requestSignal?.aborted) abortForRequestSignal();
  else requestSignal?.addEventListener('abort', abortForRequestSignal, { once: true });

  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort);
      res.off('close', abort);
      res.off('error', abortWithError);
      requestSignal?.removeEventListener('abort', abortForRequestSignal);
    },
  };
}

function waitForDrain(req: Request, res: Response, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      req.off('aborted', onClosed);
      res.off('close', onClosed);
      res.off('drain', onDrain);
      res.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      cleanup();
      callback();
    };
    const onClosed = () => settle(() => reject(new ExportStreamClosedError()));
    const onDrain = () => settle(resolve);
    const onError = (error: Error) => settle(() => reject(error));
    const onAbort = () => settle(() => reject(
      signal?.reason instanceof Error ? signal.reason : new ExportStreamClosedError(),
    ));

    req.once('aborted', onClosed);
    res.once('close', onClosed);
    res.once('drain', onDrain);
    res.once('error', onError);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function writeExportChunk(
  req: Request,
  res: Response,
  chunk: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (req.destroyed || res.destroyed) throw new ExportStreamClosedError();
  if (!res.write(chunk)) await waitForDrain(req, res, signal);
}

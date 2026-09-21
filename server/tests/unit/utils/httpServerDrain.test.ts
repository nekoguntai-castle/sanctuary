import { describe, expect, it, vi } from 'vitest';
import { createServer, get, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createHttpServerDrain,
  createShutdownState,
} from '../../../src/utils/httpServerDrain';

type CloseCallback = (error?: Error) => void;

function createServerDouble() {
  let closeCallback: CloseCallback | undefined;
  const close = vi.fn((callback: CloseCallback) => {
    closeCallback = callback;
  });

  return {
    server: { close },
    completeClose: (error?: Error) => closeCallback?.(error),
  };
}

describe('createHttpServerDrain', () => {
  it('refuses new admission while an in-flight request drains before cleanup', async () => {
    let admitRequest: (() => void) | undefined;
    let heldResponse: ServerResponse | undefined;
    const admitted = new Promise<void>(resolve => {
      admitRequest = resolve;
    });
    const server = createServer((_request, response) => {
      heldResponse = response;
      response.writeHead(200);
      response.write('held');
      admitRequest?.();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    const firstResponseComplete = new Promise<void>((resolve, reject) => {
      const request = get({
        host: '127.0.0.1',
        port: address.port,
        agent: false,
      }, response => {
        response.resume();
        response.once('end', resolve);
        response.once('error', reject);
      });
      request.once('error', reject);
    });

    try {
      await admitted;
      const events: string[] = [];
      let drainSettled = false;
      const drain = createHttpServerDrain(server).begin().then(errors => {
        drainSettled = true;
        events.push('drained');
        return errors;
      });
      const cleanup = drain.then(() => {
        events.push('dependencies-stopped');
      });

      const refusedAdmission = new Promise<void>((resolve, reject) => {
        const request = get({
          host: '127.0.0.1',
          port: address.port,
          agent: false,
        }, response => {
          response.resume();
          reject(new Error('request was admitted after shutdown began'));
        });
        request.once('error', error => {
          if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
            resolve();
          } else {
            reject(error);
          }
        });
      });

      await refusedAdmission;
      expect(drainSettled).toBe(false);
      expect(events).toEqual([]);

      heldResponse?.end('done');
      await firstResponseComplete;
      await expect(drain).resolves.toEqual([]);
      await cleanup;

      expect(events).toEqual(['drained', 'dependencies-stopped']);
    } finally {
      heldResponse?.end();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('stops admission synchronously and waits for admitted requests to drain', async () => {
    const { server, completeClose } = createServerDouble();
    const events: string[] = [];
    server.close.mockImplementation(callback => {
      events.push('http-admission-stopped');
      (server as typeof server & { callback?: CloseCallback }).callback = callback;
    });
    const websocketServer = {
      close: vi.fn(() => events.push('websockets-closed')),
    };
    const drain = createHttpServerDrain(server, [websocketServer]);

    let settled = false;
    const result = drain.begin().then(value => {
      settled = true;
      events.push('request-dependencies-stopped');
      return value;
    });

    expect(server.close).toHaveBeenCalledOnce();
    expect(events).toEqual(['http-admission-stopped', 'websockets-closed']);
    await Promise.resolve();
    expect(settled).toBe(false);

    (server as typeof server & { callback?: CloseCallback }).callback?.();

    await expect(result).resolves.toEqual([]);
    expect(settled).toBe(true);
    expect(websocketServer.close).toHaveBeenCalledOnce();
    expect(events).toEqual([
      'http-admission-stopped',
      'websockets-closed',
      'request-dependencies-stopped',
    ]);
  });

  it('shares one drain across repeated shutdown requests', async () => {
    const { server, completeClose } = createServerDouble();
    const drain = createHttpServerDrain(server);

    const first = drain.begin();
    const second = drain.begin();

    expect(second).toBe(first);
    expect(server.close).toHaveBeenCalledOnce();

    completeClose();
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
  });

  it('treats a pre-listen close result as a successful drain', async () => {
    const { server, completeClose } = createServerDouble();
    const drain = createHttpServerDrain(server);
    const result = drain.begin();
    const error = Object.assign(new Error('Server is not running.'), {
      code: 'ERR_SERVER_NOT_RUNNING',
    });

    completeClose(error);

    await expect(result).resolves.toEqual([]);
  });

  it('returns a non-benign callback error without rejecting', async () => {
    const { server, completeClose } = createServerDouble();
    const drain = createHttpServerDrain(server);
    const result = drain.begin();
    const error = Object.assign(new Error('close failed'), { code: 'EIO' });

    completeClose(error);

    await expect(result).resolves.toEqual([error]);
  });

  it('returns a defensive synchronous close error without rejecting', async () => {
    const error = new Error('close threw');
    const server = {
      close: vi.fn(() => {
        throw error;
      }),
    };

    const result = createHttpServerDrain(server).begin();

    await expect(result).resolves.toEqual([error]);
  });

  it('normalizes a non-Error synchronous close failure', async () => {
    const server = {
      close: vi.fn(() => {
        throw 'close threw';
      }),
    };

    const [error] = await createHttpServerDrain(server).begin();

    expect(error).toEqual(new Error('close threw'));
  });

  it('contains WebSocket close errors and continues closing peers', async () => {
    const { server, completeClose } = createServerDouble();
    const error = new Error('websocket close failed');
    const secondClose = vi.fn();
    const drain = createHttpServerDrain(server, [
      { close: () => { throw error; } },
      { close: secondClose },
    ]);

    const result = drain.begin();
    completeClose();

    await expect(result).resolves.toEqual([error]);
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it('normalizes a non-Error WebSocket close failure', async () => {
    const { server, completeClose } = createServerDouble();
    const drain = createHttpServerDrain(server, [{ close: () => { throw 7; } }]);

    const result = drain.begin();
    completeClose();

    const [error] = await result;
    expect(error).toEqual(new Error('7'));
  });
});

describe('createShutdownState', () => {
  it('keeps one cleanup owner and promotes a repeated fatal signal', () => {
    const state = createShutdownState();

    expect(state.begin(0)).toBe(true);
    expect(state.begin(1)).toBe(false);
    expect(state.getExitCode()).toBe(1);
  });

  it('records a close failure without interrupting the cleanup owner', () => {
    const state = createShutdownState();

    expect(state.begin(0)).toBe(true);
    state.fail();

    expect(state.getExitCode()).toBe(1);
  });
});

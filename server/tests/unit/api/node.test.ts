/**
 * Tests for node.ts API routes
 * Tests Electrum server connection testing endpoint
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express, { Express, NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'events';

// Mock JWT verification
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn((token: string) => {
      if (token === 'valid-token') {
        return { userId: 'user-1', type: 'access' };
      }
      throw new Error('Invalid token');
    }),
  },
}));

const createMockSocket = () => {
  const socket = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  socket.write = vi.fn();
  socket.destroy = vi.fn();
  return socket;
};

// Mock net module
let mockSocket = createMockSocket();

vi.mock('net', () => ({
  __esModule: true,
  default: {
    connect: vi.fn(() => {
      mockSocket = createMockSocket();
      return mockSocket;
    }),
  },
  connect: vi.fn(() => {
    mockSocket = createMockSocket();
    return mockSocket;
  }),
}));

// Mock tls module
let mockTlsSocket = createMockSocket();

vi.mock('tls', () => ({
  __esModule: true,
  default: {
    connect: vi.fn(() => {
      mockTlsSocket = createMockSocket();
      return mockTlsSocket;
    }),
  },
  connect: vi.fn(() => {
    mockTlsSocket = createMockSocket();
    return mockTlsSocket;
  }),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided' });
    }
    if (auth !== 'Bearer valid-token') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
    (req as any).user = { userId: 'user-1', username: 'test-user', isAdmin: false };
    return next();
  },
}));

// Import router and mocked modules
import nodeRouter from '../../../src/api/node';
import { errorHandler } from '../../../src/errors/errorHandler';
import { ApiError, InternalError } from '../../../src/errors/ApiError';
import net from 'net';
import tls from 'tls';

const mockNetConnect = net.connect as ReturnType<typeof vi.fn>;
const mockTlsConnect = tls.connect as ReturnType<typeof vi.fn>;

const waitForCall = async (mockFn: ReturnType<typeof vi.fn>) => {
  for (let i = 0; i < 50; i += 1) {
    if (mockFn.mock.calls.length > 0) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Expected socket connect to be called');
};

const getLastSocket = async (mockFn: ReturnType<typeof vi.fn>) => {
  await waitForCall(mockFn);
  const result = mockFn.mock.results[mockFn.mock.results.length - 1];
  return result?.value as EventEmitter;
};

const waitForListener = async (getEmitter: () => EventEmitter, event: string) => {
  for (let i = 0; i < 50; i += 1) {
    const emitter = getEmitter();
    if (emitter.listenerCount(event) > 0) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Listener not attached for event: ${event}`);
};

type HandlerResponse = {
  status: number;
  headers: Record<string, string>;
  body?: any;
};

class RequestBuilder {
  private headers: Record<string, string> = {};
  private body: unknown;

  constructor(private method: string, private url: string) {}

  set(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  send(body?: unknown): Promise<HandlerResponse> {
    this.body = body;
    return this.exec();
  }

  then<TResult1 = HandlerResponse, TResult2 = never>(
    onfulfilled?: ((value: HandlerResponse) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private async exec(): Promise<HandlerResponse> {
    let normalizedUrl = this.url.replace(/^\/api\/v1\/node/, '') || '/';
    if (normalizedUrl.startsWith('?')) {
      normalizedUrl = `/${normalizedUrl}`;
    }
    const [pathOnly] = normalizedUrl.split('?');
    const headers = Object.fromEntries(
      Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value])
    );

    return new Promise<HandlerResponse>((resolve, reject) => {
      const req: any = {
        method: this.method,
        url: normalizedUrl,
        path: pathOnly,
        headers,
        body: this.body ?? {},
      };

      const res: any = {
        statusCode: 200,
        headers: {},
        setHeader: (key: string, value: string) => {
          res.headers[key.toLowerCase()] = value;
        },
        status: (code: number) => {
          res.statusCode = code;
          return res;
        },
        json: (body: unknown) => {
          res.body = body;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body });
        },
        send: (body?: unknown) => {
          res.body = body;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body });
        },
      };

      nodeRouter.handle(req, res, (err?: Error) => {
        if (err) {
          // Simulate errorHandler behavior for ApiError instances
          if (err instanceof ApiError) {
            resolve({ status: err.statusCode, headers: res.headers, body: err.toResponse() });
          } else {
            const internalError = new InternalError();
            resolve({ status: 500, headers: res.headers, body: internalError.toResponse() });
          }
          return;
        }
        reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
      });
    });
  }
}

const request = (_app: unknown) => ({
  post: (url: string) => new RequestBuilder('POST', url),
});

const startAuthedRequest = (app: Express, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/node/test')
    .set('Authorization', 'Bearer valid-token')
    .send(body);

describe('Node API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/node', nodeRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset socket mocks
    mockSocket = createMockSocket();
    mockTlsSocket = createMockSocket();
    mockNetConnect.mockReturnValue(mockSocket);
    mockTlsConnect.mockReturnValue(mockTlsSocket);
  });

  describe('POST /test', () => {
    describe('Authentication', () => {
      it('should require authentication', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(401);
      });

      it('should reject invalid token', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer invalid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should require host field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('host');
      });

      it('should require port field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should require protocol field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002 });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('protocol');
      });

      it('should only support electrum node type', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ nodeType: 'bitcoin-core', host: 'example.com', port: 8332, protocol: 'tcp' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Electrum');
      });

      it('should accept electrum node type', async () => {
        // Start the request but don't await it yet
        const responsePromise = startAuthedRequest(app, {
          nodeType: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'error');
        tlsSocket.emit('error', new Error('Connection refused'));

        const response = await responsePromise;
        // Should not be a 400 validation error
        expect(response.status).toBe(200);
      });

      it('should reject invalid port number', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 'invalid', protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should reject port 0', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 0, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should reject port > 65535', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 70000, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });
    });

    describe('SSL Connection', () => {
      it('should use tls.connect for ssl protocol', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['ElectrumX 1.16.0', '1.4'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(mockTlsConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'electrum.example.com',
            port: 50002,
            rejectUnauthorized: true,
          })
        );
      });

      it('should allow self-signed SSL certificates only when explicitly requested', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
          allowSelfSignedCertificate: true,
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['ElectrumX 1.16.0', '1.4'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(mockTlsConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            rejectUnauthorized: false,
          })
        );
      });

      it('should return server info on successful SSL connection', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['ElectrumX 1.16.0', '1.4'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo).toEqual({
          server: 'ElectrumX 1.16.0',
          protocol: '1.4',
        });
      });
    });

    describe('TCP Connection', () => {
      it('should use net.connect for tcp protocol', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50001,
          protocol: 'tcp',
        });

        const netSocket = await getLastSocket(mockNetConnect);
        await waitForListener(() => netSocket, 'connect');
        netSocket.emit('connect');
        netSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['Fulcrum 1.9.0', '1.4.2'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(mockNetConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'electrum.example.com',
            port: 50001,
          })
        );
      });

      it('should return server info on successful TCP connection', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50001,
          protocol: 'tcp',
        });

        const netSocket = await getLastSocket(mockNetConnect);
        await waitForListener(() => netSocket, 'connect');
        netSocket.emit('connect');
        netSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['Fulcrum 1.9.0', '1.4.2'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo).toEqual({
          server: 'Fulcrum 1.9.0',
          protocol: '1.4.2',
        });
      });
    });

    describe('Error Handling', () => {
      it('should handle connection errors', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'error');
        tlsSocket.emit('error', new Error('Connection refused'));

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Connection refused');
      });

      it('should resolve with timeout message when connection never responds', async () => {
        vi.useFakeTimers();
        try {
          const responsePromise = startAuthedRequest(app, {
            host: 'electrum.example.com',
            port: 50002,
            protocol: 'ssl',
          });

          await getLastSocket(mockTlsConnect);
          await vi.advanceTimersByTimeAsync(10000);

          const response = await responsePromise;
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(false);
          expect(response.body.message).toContain('Connection timeout (10 seconds)');
        } finally {
          vi.useRealTimers();
        }
      });

      it('should handle socket timeout', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'timeout');
        tlsSocket.emit('timeout');

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('timeout');
      });

      it('should handle Electrum protocol errors', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32600, message: 'Invalid version' },
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Electrum error');
      });

      it('should handle empty server version result', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: [],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo.server).toBe('Unknown');
        expect(response.body.serverInfo.protocol).toBe('Unknown');
      });

      it('should handle synchronous socket setup errors', async () => {
        mockTlsConnect.mockImplementationOnce(() => {
          throw new Error('socket setup failed');
        });

        const response = await startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Connection error: socket setup failed');
      });

      it('should return 500 for unexpected route handler errors', async () => {
        const explodingBody = {};
        Object.defineProperty(explodingBody, 'host', {
          enumerable: true,
          get() {
            throw new Error('exploding body');
          },
        });

        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send(explodingBody);

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('Protocol Behavior', () => {
      it('should send server.version request on connect', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        // Verify write was called with JSON-RPC request
        expect(tlsSocket.write).toHaveBeenCalledWith(
          expect.stringContaining('"method":"server.version"')
        );
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: ['Test', '1.4'],
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
      });

      it('should handle chunked data', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        // Send response in two chunks
        tlsSocket.emit('data', '{"jsonrpc":"2.0","id":1,');
        tlsSocket.emit('data', '"result":["ElectrumX","1.4"]}\n');

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('should handle response without result', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
          }) + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Connected successfully');
      });

      it('should ignore late success/error responses after initial resolution', async () => {
        const responsePromise = startAuthedRequest(app, {
          host: 'electrum.example.com',
          port: 50002,
          protocol: 'ssl',
        });

        const tlsSocket = await getLastSocket(mockTlsConnect);
        await waitForListener(() => tlsSocket, 'connect');
        tlsSocket.emit('connect');
        tlsSocket.emit(
          'data',
          [
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: ['ElectrumX', '1.4'] }),
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'late error' } }),
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: ['LateServer', '2.0'] }),
          ].join('\n') + '\n'
        );

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo).toEqual({
          server: 'ElectrumX',
          protocol: '1.4',
        });
        expect((tlsSocket as any).destroy).toHaveBeenCalledTimes(1);
      });
    });
  });
});

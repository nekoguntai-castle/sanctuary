import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
}));
vi.mock('../../../src/models/prisma', () => ({ default: { pushDevice: db } }));
vi.mock('../../../src/repositories', async () => ({
  pushDeviceRepository: await import('../../../src/repositories/pushDeviceRepository'),
  auditLogRepository: { create: vi.fn() },
}));
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: () => void) => {
    req.user = { userId: String(req.headers['x-test-user-id']), username: 'test', isAdmin: false };
    next();
  },
  requireAuthenticatedUser: (req: Request) => req.user,
}));
vi.mock('../../../src/middleware/gatewayAuth', () => ({ verifyGatewayRequest: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
import router from '../../../src/api/push';

const token = 'a'.repeat(150);
interface DeviceRow {
  id: string; userId: string; token: string; platform: string;
  createdAt: Date; lastUsedAt: Date;
}
interface RouteResponse { status: number; body: unknown }
function invoke(method: string, url: string, userId: string, body = {}): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    const req = { method, url, originalUrl: url, headers: { 'x-test-user-id': userId }, body } as unknown as Request;
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(result: unknown) { resolve({ status: this.statusCode, body: result }); },
    } as Response;
    router(req, res, (error?: unknown) => {
      if (error) {
        const status = typeof error === 'object' && 'statusCode' in error
          && typeof error.statusCode === 'number' ? error.statusCode : 500;
        resolve({ status, body: {} });
      }
      else reject(new Error('unhandled route'));
    });
  });
}

it.each(['/unregister', '/devices/device-1'])('preserves B registration after stale A deletion %s', async path => {
  vi.resetAllMocks();
  let row: DeviceRow | null = {
    id: 'device-1', userId: 'A', token, platform: 'android',
    createdAt: new Date(0), lastUsedAt: new Date(0),
  };
  let reached!: () => void;
  let release!: () => void;
  let timer!: ReturnType<typeof setTimeout>;
  const admitted = new Promise<void>((resolve, reject) => {
    reached = resolve;
    timer = setTimeout(() => reject(new Error('deletion did not reach Prisma')), 2000);
  });
  const gate = new Promise<void>(resolve => { release = resolve; });
  db.findUnique.mockImplementation(async () => row && { ...row });
  db.upsert.mockImplementation(async (args: { where: { token: string }; update: Partial<DeviceRow> }) => {
    expect(args.where).toEqual({ token });
    row = { ...row!, ...args.update };
    return { ...row };
  });
  const remove = async (args: { where: Partial<DeviceRow> }) => {
    reached();
    await gate;
    // Evaluate the actual repository predicate when the modeled database write commits.
    const matches = row && Object.entries(args.where).every(([key, value]) => row![key as keyof DeviceRow] === value);
    if (matches) { row = null; return 1; }
    return 0;
  };
  db.delete.mockImplementation(remove);
  db.deleteMany.mockImplementation(async args => ({ count: await remove(args) }));
  const deleting = invoke('DELETE', path, 'A', { token });
  try {
    await admitted;
    const registering = await invoke('POST', '/register', 'B', { token, platform: 'android' });
    expect(registering.status).toBe(200);
    expect(row?.userId).toBe('B');
    release();
    const response = await deleting;
    expect(row?.userId).toBe('B');
    expect(response.status).toBe(path === '/unregister' ? 200 : 404);
  } finally {
    clearTimeout(timer);
    release();
    await Promise.allSettled([deleting]);
  }
});

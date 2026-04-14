import { beforeEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

export let mockReq: Partial<Request>;
export let mockRes: Partial<Response>;
export let mockNext: NextFunction;
export let jsonMock: ReturnType<typeof vi.fn>;
export let statusMock: ReturnType<typeof vi.fn>;

export function registerValidateRequestTestHarness() {
  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {},
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = vi.fn();
  });
}

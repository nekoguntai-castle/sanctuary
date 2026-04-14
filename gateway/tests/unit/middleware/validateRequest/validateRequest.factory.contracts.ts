import { expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { loginSchema, validate } from '../../../../src/middleware/validateRequest';
import { mockNext, mockReq, mockRes, statusMock } from './validateRequestTestHarness';

export function registerValidateFactoryContracts() {
  it('should create middleware that validates against provided schema', () => {
    const middleware = validate(loginSchema);
    mockReq.body = { username: 'test', password: 'pass' };

    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should reject invalid data with created middleware', () => {
    const middleware = validate(loginSchema);
    mockReq.body = { username: 'test' }; // Missing password

    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should forward non-zod errors to next()', () => {
    const middleware = validate({
      parse: () => {
        throw new Error('boom');
      },
    } as any);

    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(statusMock).not.toHaveBeenCalled();
  });
}

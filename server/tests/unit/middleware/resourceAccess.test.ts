import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createResourceAccessMiddleware } from '../../../src/middleware/resourceAccess';
import { createMockRequest, createMockResponse, createMockNext } from '../../helpers/testUtils';

type WidgetRole = 'viewer' | 'owner' | null;

describe('createResourceAccessMiddleware', () => {
  const userId = 'test-user-id';
  const user = { userId, username: 'testuser', isAdmin: false };

  const mockGetRole = vi.fn();
  const mockAttach = vi.fn();
  const viewPredicate = vi.fn((role: WidgetRole) => role !== null);
  const ownerPredicate = vi.fn((role: WidgetRole) => role === 'owner');

  const requireAccess = createResourceAccessMiddleware<'view' | 'owner', WidgetRole>({
    resourceName: 'Widget',
    loggerName: 'MW:WIDGET',
    paramNames: ['widgetId', 'id'],
    getRole: mockGetRole,
    predicates: {
      view: viewPredicate,
      owner: ownerPredicate,
    },
    attachToRequest: mockAttach,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no resource ID in params', async () => {
    const req = createMockRequest({ params: {}, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(400);
    expect(mockGetRole).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no userId', async () => {
    const req = createMockRequest({ params: { id: 'w1' } });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(401);
    expect(mockGetRole).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the predicate rejects the role', async () => {
    mockGetRole.mockResolvedValue(null);
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockGetRole).toHaveBeenCalledWith('w1', userId);
    expect(viewPredicate).toHaveBeenCalledWith(null);
    expect(getResponse().statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and attaches info when the predicate accepts the role', async () => {
    mockGetRole.mockResolvedValue('viewer');
    const req = createMockRequest({ params: { widgetId: 'w1' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockGetRole).toHaveBeenCalledWith('w1', userId);
    expect(viewPredicate).toHaveBeenCalledWith('viewer');
    expect(mockAttach).toHaveBeenCalledWith(req, 'w1', 'viewer');
    expect(next).toHaveBeenCalled();
  });

  it('runs the predicate for the requested level only', async () => {
    mockGetRole.mockResolvedValue('owner');
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('owner')(req as any, res as any, next);

    expect(ownerPredicate).toHaveBeenCalledWith('owner');
    expect(viewPredicate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls getRole exactly once per request', async () => {
    mockGetRole.mockResolvedValue('viewer');
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockGetRole).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when getRole throws', async () => {
    mockGetRole.mockRejectedValue(new Error('DB down'));
    const req = createMockRequest({ params: { id: 'w1' }, user });
    const { res, getResponse } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(getResponse().statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('prefers the first configured param name', async () => {
    mockGetRole.mockResolvedValue('viewer');
    const req = createMockRequest({
      params: { widgetId: 'preferred', id: 'fallback' },
      user,
    });
    const { res } = createMockResponse();
    const next = createMockNext();

    await requireAccess('view')(req as any, res as any, next);

    expect(mockGetRole).toHaveBeenCalledWith('preferred', userId);
  });
});

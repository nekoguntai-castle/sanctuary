import { expect, it } from 'vitest';

import { app, generateGatewaySignature, mockAuditLogCreate, request } from './pushTestHarness';

export function registerPushGatewayAuditEventsContracts() {
  it('should log a successful gateway audit event', async () => {
    const body = {
      event: 'AUTH_SUCCESS',
      category: 'auth',
      severity: 'info',
      details: { method: 'jwt' },
      ip: '192.168.1.1',
      userAgent: 'MobileApp/1.0',
      userId: 'user-123',
      username: 'testuser',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      userId: 'user-123',
      username: 'testuser',
      action: 'gateway.auth_success',
      category: 'auth',
      details: {
        method: 'jwt',
        severity: 'info',
        source: 'gateway',
      },
      ipAddress: '192.168.1.1',
      userAgent: 'MobileApp/1.0',
      success: true,
      errorMsg: null,
    });
  });

  it('should log a failed event correctly', async () => {
    const body = {
      event: 'AUTH_FAILED',
      category: 'auth',
      severity: 'high',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gateway.auth_failed',
        success: false,
        errorMsg: 'AUTH_FAILED',
      })
    );
  });

  it('should log rate limit exceeded as failure', async () => {
    const body = {
      event: 'RATE_LIMIT_EXCEEDED',
      category: 'security',
      ip: '10.0.0.1',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorMsg: 'RATE_LIMIT_EXCEEDED',
      })
    );
  });

  it('should log blocked event as failure', async () => {
    const body = {
      event: 'IP_BLOCKED',
      category: 'security',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorMsg: 'IP_BLOCKED',
      })
    );
  });

  it.each([
    'AUTH_DENIED',
    'TOKEN_EXPIRED',
    'ACCESS_FORBIDDEN',
    'TOKEN_INVALID',
    'AUTH_MISSING_TOKEN',
    'API_MISUSE',
    'REQUEST_UNAUTHORIZED',
  ])('should log %s as failure', async (event) => {
    const body = {
      event,
      category: 'security',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: `gateway.${event.toLowerCase()}`,
        success: false,
        errorMsg: event,
      })
    );
  });

  it('should use defaults for missing optional fields', async () => {
    const body = {
      event: 'CONNECTION_OPENED',
    };

    const path = '/api/v1/push/gateway-audit';
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

    const res = await request(app)
      .post('/api/v1/push/gateway-audit')
      .set('X-Gateway-Signature', signature)
      .set('X-Gateway-Timestamp', timestamp)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      userId: null,
      username: 'gateway',
      action: 'gateway.connection_opened',
      category: 'system',
      details: {
        severity: 'info',
        source: 'gateway',
      },
      ipAddress: null,
      userAgent: null,
      success: true,
      errorMsg: null,
    });
  });
}

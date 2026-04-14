import { expect, it } from 'vitest';

import {
  openApiSpec,
  expectDocumentedMethod,
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_STATS_DAYS,
} from './openapi.helpers';

import type {
  OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiAdminOpsTests() {
  it('documents admin infrastructure and DLQ routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/tor-container/status', 'get'],
      ['/admin/tor-container/start', 'post'],
      ['/admin/tor-container/stop', 'post'],
      ['/admin/metrics/cache', 'get'],
      ['/admin/websocket/stats', 'get'],
      ['/admin/dlq', 'get'],
      ['/admin/dlq/{dlqId}', 'delete'],
      ['/admin/dlq/{dlqId}/retry', 'post'],
      ['/admin/dlq/category/{category}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/tor-container/status'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminTorContainerStatusResponse',
      });
    expect(openApiSpec.components.schemas.AdminTorContainerStatusResponse.required).toEqual([
      'available',
      'exists',
      'running',
    ]);
    expect(openApiSpec.paths['/admin/tor-container/start'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminContainerActionResponse',
      });
    expect(openApiSpec.paths['/admin/tor-container/start'].post.responses[400].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.paths['/admin/tor-container/stop'].post.responses[400].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.components.schemas.AdminContainerActionResponse.required).toEqual([
      'success',
      'message',
    ]);

    expect(openApiSpec.paths['/admin/metrics/cache'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminCacheMetricsResponse',
      });
    expect(openApiSpec.components.schemas.AdminCacheMetricsResponse.required).toEqual([
      'timestamp',
      'stats',
      'hitRate',
    ]);
    expect(openApiSpec.components.schemas.AdminCacheStats).toHaveProperty('additionalProperties', true);

    expect(openApiSpec.paths['/admin/websocket/stats'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminWebSocketStatsResponse',
      });
    expect(openApiSpec.components.schemas.AdminWebSocketStatsResponse.required).toEqual([
      'connections',
      'subscriptions',
      'rateLimits',
      'recentRateLimitEvents',
    ]);
    expect(openApiSpec.components.schemas.AdminWebSocketRateLimitEvent.properties.reason.enum).toEqual([
      'grace_period_exceeded',
      'per_second_exceeded',
      'subscription_limit',
      'queue_overflow',
    ]);

    expect(openApiSpec.components.schemas.AdminDeadLetterCategory.enum).toEqual([
      'sync',
      'push',
      'telegram',
      'notification',
      'electrum',
      'transaction',
      'other',
    ]);
    expect(openApiSpec.paths['/admin/dlq'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({
          maximum: 500,
          default: 100,
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/dlq'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'category',
        schema: expect.objectContaining({
          enum: ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'],
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/dlq'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeadLetterQueueResponse',
      });
    expect(openApiSpec.components.schemas.AdminDeadLetterEntry.properties.errorStack).toMatchObject({
      description: expect.stringContaining('Truncated'),
    });
    expect(openApiSpec.components.schemas.AdminDeadLetterQueueResponse.required).toEqual([
      'stats',
      'entries',
    ]);

    expect(openApiSpec.paths['/admin/dlq/{dlqId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'dlqId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/dlq/{dlqId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSuccessResponse',
      });
    expect(openApiSpec.components.schemas.AdminSuccessResponse.required).toEqual(['success']);

    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeadLetterRetryResponse',
      });
    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/AdminSimpleErrorResponse',
      });
    expect(openApiSpec.paths['/admin/dlq/{dlqId}/retry'].post.responses[500].content['application/json'].schema.oneOf)
      .toContainEqual({
        $ref: '#/components/schemas/ApiError',
      });
    expect(openApiSpec.components.schemas.AdminDeadLetterRetryResponse.required).toEqual([
      'entry',
      'retry',
    ]);

    expect(openApiSpec.paths['/admin/dlq/category/{category}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'category',
        schema: { type: 'string', enum: ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'] },
      }),
    );
    expect(openApiSpec.paths['/admin/dlq/category/{category}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminClearDeadLetterCategoryResponse',
      });
    expect(openApiSpec.components.schemas.AdminClearDeadLetterCategoryResponse.required).toEqual([
      'success',
      'removed',
    ]);
  });

  it('documents admin monitoring service routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/monitoring/services', 'get'],
      ['/admin/monitoring/services/{serviceId}', 'put'],
      ['/admin/monitoring/grafana', 'get'],
      ['/admin/monitoring/grafana', 'put'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminMonitoringServiceId.enum).toEqual([
      'grafana',
      'prometheus',
      'jaeger',
    ]);
    expect(openApiSpec.paths['/admin/monitoring/services'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'checkHealth',
        in: 'query',
        schema: expect.objectContaining({
          type: 'boolean',
          default: false,
        }),
      }),
    );
    expect(openApiSpec.paths['/admin/monitoring/services'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminMonitoringServicesResponse',
      });
    expect(openApiSpec.components.schemas.AdminMonitoringServicesResponse.required).toEqual([
      'enabled',
      'services',
    ]);
    expect(openApiSpec.components.schemas.AdminMonitoringService.properties.id).toEqual({
      $ref: '#/components/schemas/AdminMonitoringServiceId',
    });
    expect(openApiSpec.components.schemas.AdminMonitoringService.properties.status.enum).toEqual([
      'unknown',
      'healthy',
      'unhealthy',
    ]);

    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'serviceId',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: ['grafana', 'prometheus', 'jaeger'] },
      }),
    );
    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateMonitoringServiceRequest',
      });
    expect(openApiSpec.components.schemas.AdminUpdateMonitoringServiceRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminUpdateMonitoringServiceRequest.properties.customUrl).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.paths['/admin/monitoring/services/{serviceId}'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminSuccessResponse',
      });

    expect(openApiSpec.paths['/admin/monitoring/grafana'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGrafanaConfigResponse',
      });
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.required).toEqual([
      'username',
      'passwordSource',
      'password',
      'anonymousAccess',
      'anonymousAccessNote',
    ]);
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.properties.passwordSource.enum).toEqual([
      'GRAFANA_PASSWORD',
      'ENCRYPTION_KEY',
    ]);
    expect(openApiSpec.components.schemas.AdminGrafanaConfigResponse.properties.password).toMatchObject({
      format: 'password',
    });

    expect(openApiSpec.paths['/admin/monitoring/grafana'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateGrafanaRequest',
      });
    expect(openApiSpec.components.schemas.AdminUpdateGrafanaRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.paths['/admin/monitoring/grafana'].put.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGrafanaUpdateResponse',
      });
    expect(openApiSpec.components.schemas.AdminGrafanaUpdateResponse.required).toEqual([
      'success',
      'message',
    ]);
  });

  it('documents admin user management routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/users', 'get'],
      ['/admin/users', 'post'],
      ['/admin/users/{userId}', 'put'],
      ['/admin/users/{userId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminUser.required).toEqual([
      'id',
      'username',
      'email',
      'emailVerified',
      'isAdmin',
      'createdAt',
    ]);
    expect(openApiSpec.components.schemas.AdminUser.properties.email).toMatchObject({
      format: 'email',
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.required).toEqual([
      'username',
      'password',
      'email',
    ]);
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.username).toMatchObject({
      minLength: 3,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.password).toMatchObject({
      minLength: 8,
    });
    expect(openApiSpec.components.schemas.AdminCreateUserRequest.properties.email).toMatchObject({
      format: 'email',
    });
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.required).toBeUndefined();
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.properties.email.oneOf).toContainEqual({
      type: 'string',
      format: 'email',
    });
    expect(openApiSpec.components.schemas.AdminUpdateUserRequest.properties.email.oneOf).toContainEqual({
      type: 'string',
      enum: [''],
    });
    expect(openApiSpec.paths['/admin/users'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/AdminUser' },
    });
    expect(openApiSpec.paths['/admin/users'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminCreateUserRequest',
    });
    expect(openApiSpec.paths['/admin/users'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminUser',
    });
    expect(openApiSpec.paths['/admin/users/{userId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'userId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/users/{userId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateUserRequest',
      });
    expect(openApiSpec.paths['/admin/users/{userId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeleteUserResponse',
      });
  });

  it('documents admin group management routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/groups', 'get'],
      ['/admin/groups', 'post'],
      ['/admin/groups/{groupId}', 'put'],
      ['/admin/groups/{groupId}', 'delete'],
      ['/admin/groups/{groupId}/members', 'post'],
      ['/admin/groups/{groupId}/members/{userId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.AdminGroupRole.enum).toEqual(['member', 'admin']);
    expect(openApiSpec.components.schemas.AdminGroup.required).toEqual([
      'id',
      'name',
      'description',
      'purpose',
      'createdAt',
      'updatedAt',
      'members',
    ]);
    expect(openApiSpec.components.schemas.AdminGroup.properties.description).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminGroup.properties.purpose).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminGroup.properties.members.items).toEqual({
      $ref: '#/components/schemas/AdminGroupMember',
    });
    expect(openApiSpec.components.schemas.AdminGroupMember.required).toEqual([
      'userId',
      'username',
      'role',
    ]);
    expect(openApiSpec.components.schemas.AdminGroupMember.properties.role).toEqual({
      $ref: '#/components/schemas/AdminGroupRole',
    });
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest.required).toEqual(['name']);
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest.properties.memberIds.items).toEqual({
      type: 'string',
    });
    expect(openApiSpec.components.schemas.AdminCreateGroupRequest).toHaveProperty(
      'additionalProperties',
      false,
    );
    expect(openApiSpec.components.schemas.AdminUpdateGroupRequest.required).toBeUndefined();
    expect(openApiSpec.components.schemas.AdminUpdateGroupRequest.properties.description).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminAddGroupMemberRequest.required).toEqual(['userId']);
    expect(openApiSpec.components.schemas.AdminAddGroupMemberRequest.properties.role).toEqual({
      $ref: '#/components/schemas/AdminGroupRole',
    });
    expect(openApiSpec.paths['/admin/groups'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/AdminGroup' },
    });
    expect(openApiSpec.paths['/admin/groups'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminCreateGroupRequest',
    });
    expect(openApiSpec.paths['/admin/groups'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminGroup',
    });
    expect(openApiSpec.paths['/admin/groups/{groupId}'].put.parameters).toContainEqual(
      expect.objectContaining({
        name: 'groupId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/groups/{groupId}'].put.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminUpdateGroupRequest',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminDeleteGroupResponse',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminAddGroupMemberRequest',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.responses).toHaveProperty('409');
    expect(openApiSpec.paths['/admin/groups/{groupId}/members'].post.responses[201].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminGroupMember',
      });
    expect(openApiSpec.paths['/admin/groups/{groupId}/members/{userId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'userId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/groups/{groupId}/members/{userId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminRemoveGroupMemberResponse',
      });
  });

  it('documents admin system policy routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/policies', 'get'],
      ['/admin/policies', 'post'],
      ['/admin/policies/{policyId}', 'patch'],
      ['/admin/policies/{policyId}', 'delete'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths).not.toHaveProperty('/admin/groups/{groupId}/policies');
    expect(openApiSpec.paths['/admin/policies'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VaultPolicyListResponse',
    });
    expect(openApiSpec.paths['/admin/policies'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CreateVaultPolicyRequest',
    });
    expect(openApiSpec.paths['/admin/policies'].post.responses[201].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VaultPolicyResponse',
    });
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.required).toEqual([
      'name',
      'type',
      'config',
    ]);
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.properties.type.enum).toEqual([
      ...VALID_POLICY_TYPES,
    ]);
    expect(openApiSpec.components.schemas.CreateVaultPolicyRequest.properties.enforcement.enum).toEqual([
      ...VALID_ENFORCEMENT_MODES,
    ]);
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.parameters).toContainEqual(
      expect.objectContaining({
        name: 'policyId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.requestBody.content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/UpdateVaultPolicyRequest',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/VaultPolicyResponse',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses).toHaveProperty('403');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].patch.responses).toHaveProperty('404');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.parameters).toContainEqual(
      expect.objectContaining({
        name: 'policyId',
        in: 'path',
        required: true,
      }),
    );
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminPolicyDeleteResponse',
      });
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses).toHaveProperty('403');
    expect(openApiSpec.paths['/admin/policies/{policyId}'].delete.responses).toHaveProperty('404');
    expect(openApiSpec.components.schemas.AdminPolicyDeleteResponse.required).toEqual(['success']);
  });

  it('documents admin audit log routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/audit-logs', 'get'],
      ['/admin/audit-logs/stats', 'get'],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths['/admin/audit-logs'].get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminAuditLogsResponse',
    });
    expect(openApiSpec.paths['/admin/audit-logs'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'username',
        schema: expect.objectContaining({ type: 'string' }),
      }),
    );
    expect(openApiSpec.paths['/admin/audit-logs'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'limit',
        schema: expect.objectContaining({
          maximum: 500,
          default: AUDIT_DEFAULT_PAGE_SIZE,
        }),
      }),
    );
    expect(openApiSpec.components.schemas.AdminAuditLogsResponse.required).toEqual([
      'logs',
      'total',
      'limit',
      'offset',
    ]);
    expect(openApiSpec.components.schemas.AdminAuditLog.properties.userId).toMatchObject({
      nullable: true,
    });
    expect(openApiSpec.components.schemas.AdminAuditLog.properties.details).toMatchObject({
      nullable: true,
    });

    expect(openApiSpec.paths['/admin/audit-logs/stats'].get.responses[200].content['application/json'].schema)
      .toEqual({
        $ref: '#/components/schemas/AdminAuditStatsResponse',
      });
    expect(openApiSpec.paths['/admin/audit-logs/stats'].get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'days',
        schema: expect.objectContaining({ minimum: 1, default: AUDIT_STATS_DAYS }),
      }),
    );
    expect(openApiSpec.components.schemas.AdminAuditStatsResponse.required).toEqual([
      'totalEvents',
      'byCategory',
      'byAction',
      'failedEvents',
    ]);
  });
}

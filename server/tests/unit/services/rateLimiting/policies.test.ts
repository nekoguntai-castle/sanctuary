/**
 * Rate Limit Policies Tests
 *
 * Tests for rate limit policy configuration and retrieval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config module
const mockConfig = vi.hoisted(() => ({
  rateLimit: {
    loginAttempts: 5,
    loginWindowSeconds: 900,
    registerAttempts: 3,
    registerWindowSeconds: 3600,
    twoFaAttempts: 5,
    twoFaWindowSeconds: 900,
    passwordChangeAttempts: 3,
    passwordChangeWindowSeconds: 3600,
    apiDefaultLimit: 100,
    apiHeavyLimit: 20,
    apiPublicLimit: 30,
    syncTriggerLimit: 10,
    syncBatchLimit: 5,
    txCreateLimit: 30,
    txBroadcastLimit: 10,
    aiAnalyzeLimit: 20,
    aiSummarizeLimit: 30,
    aiWindowSeconds: 3600,
    adminDefaultLimit: 200,
    payjoinCreateLimit: 10,
    wsConnectLimit: 20,
    wsMessageLimit: 100,
  },
  mcp: {
    rateLimitPerMinute: 120,
  },
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => mockConfig,
}));

// Import after mocking
import {
  getRateLimitPolicies,
  getPolicy,
  createPolicy,
  RATE_LIMIT_POLICIES,
} from '../../../../src/services/rateLimiting/policies';

describe('Rate Limit Policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRateLimitPolicies', () => {
    it('should return all policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies).toBeDefined();
      expect(typeof policies).toBe('object');
    });

    it('should include authentication policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['auth:login']).toBeDefined();
      expect(policies['auth:register']).toBeDefined();
      expect(policies['auth:2fa']).toBeDefined();
      expect(policies['auth:password-change']).toBeDefined();
    });

    it('should include API policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['api:default']).toBeDefined();
      expect(policies['api:heavy']).toBeDefined();
      expect(policies['api:public']).toBeDefined();
    });

    it('should include sync policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['sync:trigger']).toBeDefined();
      expect(policies['sync:batch']).toBeDefined();
    });

    it('should include transaction policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['tx:create']).toBeDefined();
      expect(policies['tx:broadcast']).toBeDefined();
    });

    it('should include AI policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['ai:analyze']).toBeDefined();
      expect(policies['ai:summarize']).toBeDefined();
    });

    it('should include admin policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['admin:default']).toBeDefined();
    });

    it('should include MCP policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['mcp:default']).toBeDefined();
    });

    it('should include payjoin policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['payjoin:create']).toBeDefined();
    });

    it('should include WebSocket policies', () => {
      const policies = getRateLimitPolicies();

      expect(policies['ws:connect']).toBeDefined();
      expect(policies['ws:message']).toBeDefined();
    });

    it('should return cached policies on subsequent calls', () => {
      const policies1 = getRateLimitPolicies();
      const policies2 = getRateLimitPolicies();

      expect(policies1).toBe(policies2);
    });
  });

  describe('auth:login policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['auth:login'];

      expect(policy.name).toBe('auth:login');
      expect(policy.limit).toBe(5);
      expect(policy.windowSeconds).toBe(900);
      expect(policy.keyStrategy).toBe('ip+user');
    });

    it('should have helpful error message', () => {
      const policy = getRateLimitPolicies()['auth:login'];

      expect(policy.message).toContain('login');
      expect(policy.message).toContain('15 minutes');
    });
  });

  describe('auth:register policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['auth:register'];

      expect(policy.name).toBe('auth:register');
      expect(policy.limit).toBe(3);
      expect(policy.windowSeconds).toBe(3600);
      expect(policy.keyStrategy).toBe('ip');
    });
  });

  describe('auth:2fa policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['auth:2fa'];

      expect(policy.name).toBe('auth:2fa');
      expect(policy.limit).toBe(5);
      expect(policy.windowSeconds).toBe(900);
      expect(policy.keyStrategy).toBe('ip');
    });
  });

  describe('auth:password-change policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['auth:password-change'];

      expect(policy.name).toBe('auth:password-change');
      expect(policy.limit).toBe(3);
      expect(policy.windowSeconds).toBe(3600);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('api:default policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['api:default'];

      expect(policy.name).toBe('api:default');
      expect(policy.limit).toBe(100);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
      expect(policy.skipFailedRequests).toBe(true);
    });
  });

  describe('api:heavy policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['api:heavy'];

      expect(policy.name).toBe('api:heavy');
      expect(policy.limit).toBe(20);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('api:public policy', () => {
    it('should have correct configuration', () => {
      const policy = getRateLimitPolicies()['api:public'];

      expect(policy.name).toBe('api:public');
      expect(policy.limit).toBe(30);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('ip');
    });
  });

  describe('sync policies', () => {
    it('should configure sync:trigger correctly', () => {
      const policy = getRateLimitPolicies()['sync:trigger'];

      expect(policy.name).toBe('sync:trigger');
      expect(policy.limit).toBe(10);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });

    it('should configure sync:batch correctly', () => {
      const policy = getRateLimitPolicies()['sync:batch'];

      expect(policy.name).toBe('sync:batch');
      expect(policy.limit).toBe(5);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('transaction policies', () => {
    it('should configure tx:create correctly', () => {
      const policy = getRateLimitPolicies()['tx:create'];

      expect(policy.name).toBe('tx:create');
      expect(policy.limit).toBe(30);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });

    it('should configure tx:broadcast correctly', () => {
      const policy = getRateLimitPolicies()['tx:broadcast'];

      expect(policy.name).toBe('tx:broadcast');
      expect(policy.limit).toBe(10);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('AI policies', () => {
    it('should configure ai:analyze correctly', () => {
      const policy = getRateLimitPolicies()['ai:analyze'];

      expect(policy.name).toBe('ai:analyze');
      expect(policy.limit).toBe(20);
      expect(policy.windowSeconds).toBe(3600);
      expect(policy.keyStrategy).toBe('user');
    });

    it('should configure ai:summarize correctly', () => {
      const policy = getRateLimitPolicies()['ai:summarize'];

      expect(policy.name).toBe('ai:summarize');
      expect(policy.limit).toBe(30);
      expect(policy.windowSeconds).toBe(3600);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('WebSocket policies', () => {
    it('should configure ws:connect correctly', () => {
      const policy = getRateLimitPolicies()['ws:connect'];

      expect(policy.name).toBe('ws:connect');
      expect(policy.limit).toBe(20);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('ip');
    });

    it('should configure ws:message correctly', () => {
      const policy = getRateLimitPolicies()['ws:message'];

      expect(policy.name).toBe('ws:message');
      expect(policy.limit).toBe(100);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('user');
    });
  });

  describe('MCP policies', () => {
    it('should configure mcp:default correctly', () => {
      const policy = getRateLimitPolicies()['mcp:default'];

      expect(policy.name).toBe('mcp:default');
      expect(policy.limit).toBe(120);
      expect(policy.windowSeconds).toBe(60);
      expect(policy.keyStrategy).toBe('api-key');
    });
  });

  describe('getPolicy', () => {
    it('should return policy by name', () => {
      const policy = getPolicy('auth:login');

      expect(policy).toBeDefined();
      expect(policy?.name).toBe('auth:login');
    });

    it('should return undefined for non-existent policy', () => {
      const policy = getPolicy('non:existent');

      expect(policy).toBeUndefined();
    });

    it('should return correct policy for all standard names', () => {
      const policyNames = [
        'auth:login',
        'auth:register',
        'auth:2fa',
        'auth:password-change',
        'api:default',
        'api:heavy',
        'api:public',
        'sync:trigger',
        'sync:batch',
        'tx:create',
        'tx:broadcast',
        'ai:analyze',
        'ai:summarize',
        'admin:default',
        'mcp:default',
        'payjoin:create',
        'ws:connect',
        'ws:message',
      ];

      for (const name of policyNames) {
        const policy = getPolicy(name);
        expect(policy, `Policy ${name} should exist`).toBeDefined();
        expect(policy?.name).toBe(name);
      }
    });
  });

  describe('createPolicy', () => {
    it('should create a custom policy', () => {
      const customPolicy = createPolicy({
        name: 'custom:policy',
        limit: 50,
        windowSeconds: 120,
        keyStrategy: 'user',
        message: 'Custom rate limit exceeded',
      });

      expect(customPolicy.name).toBe('custom:policy');
      expect(customPolicy.limit).toBe(50);
      expect(customPolicy.windowSeconds).toBe(120);
      expect(customPolicy.keyStrategy).toBe('user');
      expect(customPolicy.message).toBe('Custom rate limit exceeded');
    });

    it('should preserve all policy fields', () => {
      const customPolicy = createPolicy({
        name: 'test:policy',
        limit: 10,
        windowSeconds: 60,
        keyStrategy: 'ip+user',
        message: 'Test message',
        skipFailedRequests: true,
      });

      expect(customPolicy.skipFailedRequests).toBe(true);
    });

    it('should allow creating policy without optional fields', () => {
      const minimalPolicy = createPolicy({
        name: 'minimal:policy',
        limit: 5,
        windowSeconds: 30,
        keyStrategy: 'ip',
        message: 'Minimal policy',
      });

      expect(minimalPolicy.name).toBe('minimal:policy');
      expect(minimalPolicy.skipFailedRequests).toBeUndefined();
    });
  });

  describe('RATE_LIMIT_POLICIES constant', () => {
    it('should be defined', () => {
      expect(RATE_LIMIT_POLICIES).toBeDefined();
    });

    it('should contain all policies', () => {
      expect(RATE_LIMIT_POLICIES['auth:login']).toBeDefined();
      expect(RATE_LIMIT_POLICIES['api:default']).toBeDefined();
      expect(RATE_LIMIT_POLICIES['mcp:default']).toBeDefined();
      expect(RATE_LIMIT_POLICIES['ws:connect']).toBeDefined();
    });

    it('should be the same as getRateLimitPolicies result', () => {
      const policies = getRateLimitPolicies();
      expect(RATE_LIMIT_POLICIES).toBe(policies);
    });
  });

  describe('policy key strategies', () => {
    it('should use IP strategy for public endpoints', () => {
      const policies = getRateLimitPolicies();

      expect(policies['api:public'].keyStrategy).toBe('ip');
      expect(policies['auth:register'].keyStrategy).toBe('ip');
      expect(policies['ws:connect'].keyStrategy).toBe('ip');
    });

    it('should use user strategy for authenticated endpoints', () => {
      const policies = getRateLimitPolicies();

      expect(policies['api:default'].keyStrategy).toBe('user');
      expect(policies['tx:create'].keyStrategy).toBe('user');
      expect(policies['ai:analyze'].keyStrategy).toBe('user');
    });

    it('should use API key strategy for MCP endpoints', () => {
      const policy = getRateLimitPolicies()['mcp:default'];
      expect(policy.keyStrategy).toBe('api-key');
    });

    it('should use ip+user strategy for login', () => {
      const policy = getRateLimitPolicies()['auth:login'];
      expect(policy.keyStrategy).toBe('ip+user');
    });
  });

  describe('policy message quality', () => {
    it('should have meaningful messages for all policies', () => {
      const policies = getRateLimitPolicies();

      for (const [name, policy] of Object.entries(policies)) {
        expect(policy.message, `Policy ${name} should have a message`).toBeDefined();
        expect(policy.message.length, `Policy ${name} message should be non-empty`).toBeGreaterThan(0);
      }
    });

    it('should have messages that indicate rate limiting', () => {
      const policies = getRateLimitPolicies();

      for (const policy of Object.values(policies)) {
        const messageLower = policy.message.toLowerCase();
        const hasRateLimitIndicator =
          messageLower.includes('too many') ||
          messageLower.includes('rate limit') ||
          messageLower.includes('exceeded') ||
          messageLower.includes('please') ||
          messageLower.includes('wait');

        expect(hasRateLimitIndicator, `Message "${policy.message}" should indicate rate limiting`).toBe(true);
      }
    });
  });
});

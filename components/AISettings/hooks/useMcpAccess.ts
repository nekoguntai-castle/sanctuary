import { useCallback, useEffect, useState } from 'react';
import * as adminApi from '../../../src/api/admin';
import type { McpKeyFormState } from '../types';
import { createLogger } from '../../../utils/logger';

const log = createLogger('AISettings:useMcpAccess');

const initialForm: McpKeyFormState = {
  userId: '',
  name: '',
  walletIds: '',
  allowAuditLogs: false,
  expiresAt: '',
};

export function parseWalletScopeInput(value: string): string[] | undefined {
  const walletIds = value
    .split(/[\s,]+/)
    .map((walletId) => walletId.trim())
    .filter(Boolean);
  return walletIds.length > 0 ? Array.from(new Set(walletIds)) : undefined;
}

export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function getMcpKeyLifecycle(key: adminApi.AdminMcpApiKey, now = new Date()): 'active' | 'expired' | 'revoked' {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function useMcpAccess(enabled: boolean) {
  const [status, setStatus] = useState<adminApi.AdminMcpServerStatus | null>(null);
  const [keys, setKeys] = useState<adminApi.AdminMcpApiKey[]>([]);
  const [users, setUsers] = useState<adminApi.AdminUser[]>([]);
  const [form, setForm] = useState<McpKeyFormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextKeys, nextUsers] = await Promise.all([
        adminApi.getMcpServerStatus(),
        adminApi.listMcpApiKeys(),
        adminApi.getUsers(),
      ]);
      setStatus(nextStatus);
      setKeys(nextKeys);
      setUsers(nextUsers);
      setForm((current) => ({
        ...current,
        userId: current.userId || nextUsers[0]?.id || '',
      }));
    } catch (refreshError) {
      log.error('Failed to load MCP access settings', { error: refreshError });
      setError('Failed to load MCP access settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, refresh]);

  const updateForm = useCallback(<K extends keyof McpKeyFormState>(
    key: K,
    value: McpKeyFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const createKey = useCallback(async () => {
    if (!form.userId || !form.name.trim()) return;
    setIsCreating(true);
    setError(null);
    setCreatedToken(null);
    try {
      const created = await adminApi.createMcpApiKey({
        userId: form.userId,
        name: form.name.trim(),
        walletIds: parseWalletScopeInput(form.walletIds),
        allowAuditLogs: form.allowAuditLogs,
        expiresAt: localDateTimeToIso(form.expiresAt),
      });
      setKeys((current) => [created, ...current]);
      setCreatedToken(created.apiKey);
      setForm((current) => ({
        ...initialForm,
        userId: current.userId,
      }));
    } catch (createError) {
      log.error('Failed to create MCP API key', { error: createError });
      setError('Failed to create MCP API key');
    } finally {
      setIsCreating(false);
    }
  }, [form]);

  const revokeKey = useCallback(async (keyId: string) => {
    setRevokingKeyId(keyId);
    setError(null);
    try {
      const revoked = await adminApi.revokeMcpApiKey(keyId);
      setKeys((current) => current.map((key) => (
        key.id === revoked.id ? revoked : key
      )));
    } catch (revokeError) {
      log.error('Failed to revoke MCP API key', { error: revokeError });
      setError('Failed to revoke MCP API key');
    } finally {
      setRevokingKeyId(null);
    }
  }, []);

  return {
    status,
    keys,
    users,
    form,
    loading,
    isCreating,
    revokingKeyId,
    createdToken,
    error,
    updateForm,
    createKey,
    revokeKey,
    dismissCreatedToken: () => setCreatedToken(null),
    refresh,
  };
}

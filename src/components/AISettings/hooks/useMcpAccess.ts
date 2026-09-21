import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as adminApi from '../../../api/admin';
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
  const mountedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const refreshGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const ownsRefresh = useCallback((generation: number) => (
    mountedRef.current
    && enabledRef.current
    && refreshGenerationRef.current === generation
  ), []);

  const invalidateRefresh = useCallback(() => {
    refreshGenerationRef.current += 1;
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current || !enabledRef.current) return;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextKeys, nextUsers] = await Promise.all([
        adminApi.getMcpServerStatus(),
        adminApi.listMcpApiKeys(),
        adminApi.getUsers(),
      ]);
      if (!ownsRefresh(generation)) return;
      setStatus(nextStatus);
      setKeys(nextKeys);
      setUsers(nextUsers);
      setForm((current) => ({
        ...current,
        userId: current.userId || nextUsers[0]?.id || '',
      }));
    } catch (refreshError) {
      if (!ownsRefresh(generation)) return;
      log.error('Failed to load MCP access settings', { error: refreshError });
      setError('Failed to load MCP access settings');
    } finally {
      if (ownsRefresh(generation)) setLoading(false);
    }
  }, [ownsRefresh]);

  useEffect(() => {
    if (enabled) {
      void refresh();
      return;
    }
    refreshGenerationRef.current += 1;
    setLoading(false);
  }, [enabled, refresh]);

  const updateForm = useCallback(<K extends keyof McpKeyFormState>(
    key: K,
    value: McpKeyFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const createKey = useCallback(async () => {
    if (!mountedRef.current || !enabledRef.current) return;
    if (!form.userId || !form.name.trim()) return;
    invalidateRefresh();
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
      /* v8 ignore next -- React silently drops post-unmount state writes, so this guard has no observable test assertion. */
      if (!mountedRef.current) return;
      invalidateRefresh();
      setKeys((current) => [created, ...current]);
      setCreatedToken(created.apiKey);
      setForm((current) => ({
        ...initialForm,
        userId: current.userId,
      }));
    } catch (createError) {
      if (!mountedRef.current) return;
      invalidateRefresh();
      log.error('Failed to create MCP API key', { error: createError });
      setError('Failed to create MCP API key');
    } finally {
      /* v8 ignore next -- React silently drops post-unmount state writes, so this guard has no observable test assertion. */
      if (mountedRef.current) setIsCreating(false);
    }
  }, [form, invalidateRefresh]);

  const revokeKey = useCallback(async (keyId: string) => {
    if (!mountedRef.current || !enabledRef.current) return;
    invalidateRefresh();
    setRevokingKeyId(keyId);
    setError(null);
    try {
      const revoked = await adminApi.revokeMcpApiKey(keyId);
      /* v8 ignore next -- React silently drops post-unmount state writes, so this guard has no observable test assertion. */
      if (!mountedRef.current) return;
      invalidateRefresh();
      setKeys((current) => current.map((key) => (
        key.id === revoked.id ? revoked : key
      )));
    } catch (revokeError) {
      if (!mountedRef.current) return;
      invalidateRefresh();
      log.error('Failed to revoke MCP API key', { error: revokeError });
      setError('Failed to revoke MCP API key');
    } finally {
      /* v8 ignore next -- React silently drops post-unmount state writes, so this guard has no observable test assertion. */
      if (mountedRef.current) setRevokingKeyId(null);
    }
  }, [invalidateRefresh]);

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

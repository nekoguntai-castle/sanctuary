import { AlertCircle, Check, KeyRound, Loader2, RefreshCw, Server, Trash2, X } from 'lucide-react';
import type { AdminMcpApiKey } from '../../../src/api/admin';
import { getMcpKeyLifecycle } from '../hooks/useMcpAccess';
import type { McpAccessTabProps } from '../types';

function formatDate(value?: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function formatScope(key: AdminMcpApiKey): string {
  const walletCount = key.scope.walletIds?.length ?? 0;
  return walletCount > 0 ? `${walletCount} wallet${walletCount === 1 ? '' : 's'}` : 'All accessible wallets';
}

function lifecycleClass(lifecycle: ReturnType<typeof getMcpKeyLifecycle>): string {
  if (lifecycle === 'active') return 'text-emerald-600 dark:text-emerald-400';
  if (lifecycle === 'expired') return 'text-amber-600 dark:text-amber-400';
  return 'text-sanctuary-500 dark:text-sanctuary-400';
}

export function McpAccessTab({
  status,
  keys,
  users,
  form,
  loading,
  isCreating,
  revokingKeyId,
  createdToken,
  error,
  onFormChange,
  onCreateKey,
  onRevokeKey,
  onDismissCreatedToken,
  onRefresh,
}: McpAccessTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              MCP Server
            </h3>
          </div>
          {status && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-sanctuary-500">
              <span>{status.enabled ? 'Enabled' : 'Disabled'}</span>
              <span>{status.host}:{status.port}</span>
              <span>{status.serverName} {status.serverVersion}</span>
              <span>{status.rateLimitPerMinute}/minute</span>
              <span>Rows {status.defaultPageSize}-{status.maxPageSize}</span>
              <span>{status.maxDateRangeDays} day window</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-50"
          aria-label="Refresh MCP access"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {createdToken && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="w-4 h-4" />
                <span>New MCP key created</span>
              </div>
              <code className="block break-all rounded-md bg-white/70 dark:bg-sanctuary-950/50 px-3 py-2 text-xs text-sanctuary-800 dark:text-sanctuary-100">
                {createdToken}
              </code>
            </div>
            <button
              type="button"
              onClick={onDismissCreatedToken}
              className="p-1 rounded-md text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              aria-label="Dismiss created MCP key"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="mcp-target-user" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Target User
          </label>
          <select
            id="mcp-target-user"
            value={form.userId}
            onChange={(event) => onFormChange('userId', event.target.value)}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.username}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mcp-key-name" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Key Name
          </label>
          <input
            id="mcp-key-name"
            value={form.name}
            onChange={(event) => onFormChange('name', event.target.value)}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="mcp-wallet-scope" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Wallet Scope
          </label>
          <textarea
            id="mcp-wallet-scope"
            value={form.walletIds}
            onChange={(event) => onFormChange('walletIds', event.target.value)}
            rows={3}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="mcp-expires-at" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Expires At
            </label>
            <input
              id="mcp-expires-at"
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) => onFormChange('expiresAt', event.target.value)}
              className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
            <input
              type="checkbox"
              checked={form.allowAuditLogs}
              onChange={(event) => onFormChange('allowAuditLogs', event.target.checked)}
              className="h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
            />
            <span>Allow audit log reads</span>
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={onCreateKey}
        disabled={isCreating || !form.userId || !form.name.trim()}
        className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
      >
        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        <span>{isCreating ? 'Creating...' : 'Create MCP Key'}</span>
      </button>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          MCP Keys
        </h3>
        {keys.length === 0 ? (
          <div className="rounded-lg surface-secondary p-4 text-sm text-sanctuary-500">
            No MCP keys.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
            <table className="min-w-full text-sm">
              <thead className="surface-secondary text-xs text-sanctuary-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">User</th>
                  <th className="px-3 py-2 text-left font-medium">Scope</th>
                  <th className="px-3 py-2 text-left font-medium">Last Used</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
                {keys.map((key) => {
                  const lifecycle = getMcpKeyLifecycle(key);
                  return (
                    <tr key={key.id}>
                      <td className="px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100">
                        <div>{key.name}</div>
                        <div className="text-xs text-sanctuary-400">{key.keyPrefix}</div>
                      </td>
                      <td className="px-3 py-2 text-sanctuary-600 dark:text-sanctuary-300">
                        {key.user?.username ?? key.userId}
                      </td>
                      <td className="px-3 py-2 text-sanctuary-600 dark:text-sanctuary-300">
                        {formatScope(key)}
                      </td>
                      <td className="px-3 py-2 text-sanctuary-600 dark:text-sanctuary-300">
                        {formatDate(key.lastUsedAt)}
                      </td>
                      <td className={`px-3 py-2 capitalize ${lifecycleClass(lifecycle)}`}>
                        {lifecycle}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onRevokeKey(key.id)}
                          disabled={lifecycle === 'revoked' || revokingKeyId === key.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 disabled:opacity-50"
                        >
                          {revokingKeyId === key.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          <span>Revoke</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

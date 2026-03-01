import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  BarChart3,
  Network,
  ExternalLink,
  Settings,
  Key,
  Eye,
  EyeOff,
  User,
  ShieldOff,
  Copy,
  Check,
} from 'lucide-react';
import type { MonitoringService } from '../../src/api/admin';
import type { ServiceCredentials } from './types';
import { StatusBadge } from './StatusBadge';

// Icon mapping for service cards
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  BarChart3,
  Activity,
  Network,
};

interface ServiceCardProps {
  service: MonitoringService;
  onEditUrl: (service: MonitoringService) => void;
  hostname: string;
  credentials?: ServiceCredentials;
  anonymousAccess?: boolean;
  onToggleAnonymous?: () => void;
  isTogglingAnonymous?: boolean;
}

/**
 * Card component displaying a monitoring service with its status,
 * credentials, and action buttons.
 */
export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  onEditUrl,
  hostname,
  credentials,
  anonymousAccess,
  onToggleAnonymous,
  isTogglingAnonymous,
}) => {
  const Icon = iconMap[service.icon] || Activity;
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyPassword = async () => {
    if (credentials?.password) {
      await navigator.clipboard.writeText(credentials.password);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  // Generate actual URL by replacing {host} placeholder
  const actualUrl = service.url.includes('{host}')
    ? `http://${hostname}:${service.defaultPort}`
    : service.url;

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg">
            <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {service.name}
            </h3>
            <p className="text-sm text-sanctuary-500">{service.description}</p>
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      {/* Credentials section */}
      {credentials && (
        <div className="mt-3 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-900 border border-sanctuary-200 dark:border-sanctuary-700">
          {credentials.hasAuth ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                  <User className="w-3.5 h-3.5" />
                  <span>Username:</span>
                </div>
                <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100">{credentials.username}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                  <Key className="w-3.5 h-3.5" />
                  <span>Password:</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="font-mono text-sanctuary-900 dark:text-sanctuary-100 max-w-[120px] truncate">
                    {showPassword ? credentials.password : '••••••••'}
                  </span>
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={handleCopyPassword}
                    className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                    title={copied ? 'Copied!' : 'Copy password'}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-sanctuary-400 mt-1">
                From {credentials.passwordSource} environment variable
              </p>

              {/* Anonymous access toggle for Grafana */}
              {onToggleAnonymous && (
                <div className="mt-2 pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400">
                      <ShieldOff className="w-3.5 h-3.5" />
                      <span>Anonymous viewing</span>
                    </div>
                    <button
                      onClick={onToggleAnonymous}
                      disabled={isTogglingAnonymous}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        anonymousAccess
                          ? 'bg-primary-600'
                          : 'bg-sanctuary-300 dark:bg-sanctuary-600'
                      } ${isTogglingAnonymous ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          anonymousAccess ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                        style={{ transform: anonymousAccess ? 'translateX(16px)' : 'translateX(4px)' }}
                      />
                    </button>
                  </label>
                  <p className="text-[9px] text-sanctuary-400 mt-1">
                    Requires container restart to take effect
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-sm text-emerald-600 dark:text-emerald-400">
              <ShieldOff className="w-4 h-4" />
              <span>No authentication required</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-sanctuary-600 dark:text-sanctuary-400">
          {service.isCustomUrl ? (
            <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
              Custom URL
            </span>
          ) : (
            <span className="font-mono text-xs">:{service.defaultPort}</span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onEditUrl(service)}
            className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            title="Configure URL"
          >
            <Settings className="w-4 h-4" />
          </button>
          <a
            href={actualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <span>Open</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

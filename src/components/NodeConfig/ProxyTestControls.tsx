import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import type { NodeConfig as NodeConfigType } from '../../types';
import { Button } from '../ui/Button';
import type { ProxyTestStatus } from './useProxyTorControls';

export function ProxyTestControls({
  nodeConfig,
  proxyTestStatus,
  proxyTestMessage,
  onTestProxy,
}: {
  nodeConfig: NodeConfigType;
  proxyTestStatus: ProxyTestStatus;
  proxyTestMessage: string;
  onTestProxy: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onTestProxy}
        isLoading={proxyTestStatus === 'testing'}
        disabled={proxyTestStatus === 'testing' || !nodeConfig.proxyHost || !nodeConfig.proxyPort}
      >
        Verify Connection
      </Button>
      <ProxyTestResult status={proxyTestStatus} message={proxyTestMessage} />
    </div>
  );
}

function ProxyTestResult({
  status,
  message,
}: {
  status: ProxyTestStatus;
  message: string;
}) {
  if (!message || status === 'idle') return null;

  return (
    <div className={`flex items-center gap-1.5 text-sm ${proxyTestStatusClass(status)}`}>
      {status === 'success' && <CheckCircle className="w-4 h-4" />}
      {status === 'error' && <XCircle className="w-4 h-4" />}
      {status === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
      <span>{message}</span>
    </div>
  );
}

function proxyTestStatusClass(status: ProxyTestStatus): string {
  if (status === 'success') return 'text-emerald-600';
  if (status === 'error') return 'text-rose-600';
  return 'text-blue-600';
}

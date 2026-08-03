import { ChevronRight, Shield } from 'lucide-react';
import type { NodeConfig as NodeConfigType } from '../../types';

export function ProxyTorHeader({
  nodeConfig,
  expanded,
  summary,
  onToggle,
  onConfigChange,
}: {
  nodeConfig: NodeConfigType;
  expanded: boolean;
  summary: string;
  onToggle: () => void;
  onConfigChange: (config: NodeConfigType) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
    >
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${nodeConfig.proxyEnabled ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400'}`}>
          <Shield className="w-4 h-4" />
        </div>
        <div className="text-left">
          <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Proxy / Tor</h3>
          <p className="text-xs text-sanctuary-500">{summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onConfigChange({ ...nodeConfig, proxyEnabled: !nodeConfig.proxyEnabled });
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${nodeConfig.proxyEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${nodeConfig.proxyEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
        <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
    </div>
  );
}

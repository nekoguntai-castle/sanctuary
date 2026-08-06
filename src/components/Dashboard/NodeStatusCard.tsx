import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { TabNetwork } from '../NetworkTabs';
import { BitcoinStatus } from '../../api/bitcoin';
import { formatNetworkTitle, getNetworkColorClass } from '../../app/networks';
import { TelemetryCard } from './TelemetryCard';
import { ShowMoreToggle } from '../ui/ShowMoreToggle';

type NodeStatusValue = 'unknown' | 'checking' | 'connected' | 'error';

interface NodeStatusCardProps {
  selectedNetwork: TabNetwork;
  nodeStatus: NodeStatusValue;
  bitcoinStatus: BitcoinStatus | undefined;
}

const STATUS_PRESENTATION: Record<
  NodeStatusValue,
  { label: string; dot: string; text: string; icon: typeof CheckCircle2 | null }
> = {
  connected: {
    label: 'Connected',
    dot: 'bg-success-500 animate-connected-glow',
    text: 'text-success-600',
    icon: CheckCircle2,
  },
  error: {
    label: 'Error',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    icon: XCircle,
  },
  checking: {
    label: 'Checking...',
    dot: 'bg-warning-500 animate-checking-glow',
    text: 'text-sanctuary-400',
    icon: null,
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-sanctuary-400',
    text: 'text-sanctuary-400',
    icon: null,
  },
};

/**
 * Takes the server array directly rather than digging it back out of
 * `bitcoinStatus`: the caller has already established it is non-empty, and a
 * second guard here would be unreachable.
 */
function ServerList({ servers }: { servers: NonNullable<NonNullable<NonNullable<BitcoinStatus['pool']>['stats']>['servers']> }) {
  return (
    <ul className="space-y-0.5">
      {servers.map((server) => (
        <li key={server.serverId} className="flex items-center text-[10px]">
          <span
            className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${
              !server.lastHealthCheck
                ? 'bg-sanctuary-400'
                : server.isHealthy
                  ? 'bg-success-500'
                  : 'bg-warning-500'
            }`}
            aria-hidden="true"
          />
          <span className="text-sanctuary-500 truncate max-w-[120px]">{server.label}</span>
          <span className="text-sanctuary-400 ml-1">
            ({server.connectionCount} conn{server.connectionCount !== 1 ? 's' : ''})
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The per-server list moved behind a disclosure.
 *
 * Expanded by default it made this the tallest card in a row of three, at a
 * third of the page width, for detail that answers a question most readers are
 * not asking. The headline — connected or not, and at what height — is what
 * the dashboard is for; the server breakdown is a drill-down.
 */
function NodeDetail({
  bitcoinStatus,
  nodeStatus,
  selectedNetwork,
}: {
  bitcoinStatus: BitcoinStatus | undefined;
  nodeStatus: NodeStatusValue;
  selectedNetwork: TabNetwork;
}) {
  const [expanded, setExpanded] = useState(false);

  if (nodeStatus !== 'connected' && nodeStatus !== 'checking') {
    return (
      <p className="text-sanctuary-400">
        Open Admin → Node Config to review {formatNetworkTitle(selectedNetwork)} settings.
      </p>
    );
  }

  const servers = bitcoinStatus?.pool?.stats?.servers;

  if (!bitcoinStatus || !servers || servers.length === 0) {
    return null;
  }

  return (
    <>
      <ShowMoreToggle
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        collapsedLabel={`${servers.length} server${servers.length === 1 ? '' : 's'}`}
        expandedLabel="Hide servers"
      />
      {expanded && (
        <div className="mt-2">
          <ServerList servers={servers} />
        </div>
      )}
    </>
  );
}

function NodeSupportLine({
  bitcoinStatus,
  nodeStatus,
  selectedNetwork,
}: {
  bitcoinStatus: BitcoinStatus | undefined;
  nodeStatus: NodeStatusValue;
  selectedNetwork: TabNetwork;
}) {
  if (nodeStatus !== 'connected' || !bitcoinStatus) {
    // Keeps the original wording: the reason, not just the remedy. A card that
    // only says "go and configure it" does not tell the reader whether the
    // node is misconfigured, unreachable, or simply still being checked.
    const label = formatNetworkTitle(selectedNetwork);
    return (
      <span>
        {nodeStatus === 'checking'
          ? 'Checking configured Electrum server...'
          : bitcoinStatus?.error || `${label} node status is unavailable`}
      </span>
    );
  }

  const pool = bitcoinStatus.pool;

  // Each figure keeps a word in front of it. The old card used a `Height:` /
  // `Pool:` label column; dropping the column to save vertical space is fine,
  // dropping the words is not — a bare "871,204 · 3/4" is unreadable.
  const parts: ReactNode[] = [];

  if (bitcoinStatus.blockHeight) {
    parts.push(
      <span key="height">
        <span className="text-sanctuary-400">height </span>
        {bitcoinStatus.blockHeight.toLocaleString()}
      </span>
    );
  }

  if (pool?.enabled) {
    parts.push(
      <span key="pool" title="Active / total pool connections">
        <span className="text-sanctuary-400">pool </span>
        {pool.stats ? `${pool.stats.activeConnections}/${pool.stats.totalConnections}` : 'initializing'}
      </span>
    );
  } else if (bitcoinStatus.host) {
    parts.push(
      <span key="host" className="truncate max-w-[150px]" title={bitcoinStatus.host}>
        {bitcoinStatus.useSsl && <span className="text-success-500 mr-1">🔒</span>}
        {bitcoinStatus.host}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 font-mono tabular-nums">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="text-sanctuary-300 dark:text-sanctuary-600">·</span>}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}

export const NodeStatusCard: React.FC<NodeStatusCardProps> = ({
  selectedNetwork,
  nodeStatus,
  bitcoinStatus,
}) => {
  const presentation = STATUS_PRESENTATION[nodeStatus];
  const StatusIcon = presentation.icon;

  return (
    <TelemetryCard
      title="Node Status"
      testId="telemetry-node"
      titleAdornment={
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getNetworkColorClass(selectedNetwork, 'subtleBadge')}`}
        >
          {selectedNetwork.toUpperCase()}
        </span>
      }
      headline={
        <span className={`flex items-center gap-2 text-lg ${presentation.text}`}>
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${presentation.dot}`} aria-hidden="true" />
          {StatusIcon && <StatusIcon className="w-4 h-4 shrink-0" aria-hidden="true" />}
          {presentation.label}
        </span>
      }
      support={
        <NodeSupportLine
          bitcoinStatus={bitcoinStatus}
          nodeStatus={nodeStatus}
          selectedNetwork={selectedNetwork}
        />
      }
      detail={
        <NodeDetail
          bitcoinStatus={bitcoinStatus}
          nodeStatus={nodeStatus}
          selectedNetwork={selectedNetwork}
        />
      }
    />
  );
};

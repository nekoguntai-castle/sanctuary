import React, { useMemo, useState } from 'react';
import { TabNetwork } from '../NetworkTabs';
import { formatNetworkTitle, getNetworkColorClass } from '../../app/networks';
import { TelemetryCard } from './TelemetryCard';
import { ShowMoreToggle } from '../ui/ShowMoreToggle';
import { buildNodeStatusCardModel } from './nodeStatusCardModel';
import type { NodeStatusCardModel, NodeStatusServerRow, NodeStatusTone } from './nodeStatusCardModel';
import type { NodeStatusQueryState } from './hooks/dashboardDataModel';

interface NodeStatusCardProps {
  selectedNetwork: TabNetwork;
  query: NodeStatusQueryState;
}

const SERVERS_REGION_ID = 'node-status-servers';

const TONE_TEXT_CLASS: Record<NodeStatusTone, string> = {
  neutral: 'text-sanctuary-400',
  checking: 'text-sanctuary-400',
  success: 'text-success-600',
  warning: 'text-warning-600',
  error: 'text-rose-600 dark:text-rose-400',
};

const TONE_DOT_CLASS: Record<NodeStatusTone, string> = {
  neutral: 'bg-sanctuary-400',
  checking: 'bg-warning-500 animate-checking-glow',
  success: 'bg-success-500 animate-connected-glow',
  warning: 'bg-warning-500',
  error: 'bg-rose-500',
};

function BadgeRow({ model, selectedNetwork }: { model: NodeStatusCardModel; selectedNetwork: TabNetwork }) {
  return (
    <span className="flex items-center gap-1">
      {model.badges.map((badge) => (
        <span
          key={`${badge.kind}-${badge.label}`}
          title={badge.label}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded truncate max-w-[96px] ${
            badge.kind === 'network'
              ? getNetworkColorClass(selectedNetwork, 'subtleBadge')
              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-300'
          }`}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function ServerRowView({ row }: { row: NodeStatusServerRow }) {
  return (
    <li className="flex items-center text-[10px] gap-1.5">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT_CLASS[row.tone].split(' ')[0]}`}
        aria-hidden="true"
      />
      {row.role && (
        <span className="text-sanctuary-400 shrink-0">{row.role}</span>
      )}
      <span className="text-sanctuary-500 truncate max-w-[100px]" title={row.label}>
        {row.label}
      </span>
      <span className={`ml-auto shrink-0 ${TONE_TEXT_CLASS[row.tone]}`}>{row.availability}</span>
    </li>
  );
}

function NodeDetail({ model }: { model: NodeStatusCardModel }) {
  const [expanded, setExpanded] = useState(false);

  if (model.detail.kind === 'none') {
    return null;
  }

  if (model.detail.kind === 'guidance') {
    return <p className="text-sanctuary-400">{model.detail.text}</p>;
  }

  // `kind: 'servers'` is only ever produced with a non-empty `rows` array —
  // every builder in nodeStatusCard/{balanced,failover}.ts falls back to
  // `{ kind: 'none' }` when there are no rows to show.
  const { rows, guidance } = model.detail;

  return (
    <>
      <ShowMoreToggle
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        collapsedLabel={`${rows.length} server${rows.length === 1 ? '' : 's'}`}
        expandedLabel="Hide servers"
        controls={SERVERS_REGION_ID}
      />
      {expanded && (
        <div id={SERVERS_REGION_ID} className="mt-2">
          <ul className="space-y-0.5">
            {rows.map((row) => (
              <ServerRowView key={row.serverId} row={row} />
            ))}
          </ul>
          {guidance && <p className="text-sanctuary-400 mt-1">{guidance}</p>}
        </div>
      )}
    </>
  );
}

function SupportLine({ model }: { model: NodeStatusCardModel }) {
  return (
    <span className="flex items-center gap-2 font-mono tabular-nums flex-wrap">
      {model.support.map((item, index) => (
        <React.Fragment key={item.key}>
          {index > 0 && <span className="text-sanctuary-300 dark:text-sanctuary-600">·</span>}
          <span className={item.tone ? TONE_TEXT_CLASS[item.tone] : undefined}>{item.value}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

export const NodeStatusCard: React.FC<NodeStatusCardProps> = ({ selectedNetwork, query }) => {
  const model = useMemo(
    () => buildNodeStatusCardModel({ ...query, selectedNetwork }),
    [query, selectedNetwork],
  );

  return (
    <TelemetryCard
      title="Node Status"
      testId="telemetry-node"
      titleAdornment={<BadgeRow model={model} selectedNetwork={selectedNetwork} />}
      headline={
        <span className={`flex items-center gap-2 text-lg ${TONE_TEXT_CLASS[model.tone]}`}>
          <span
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${TONE_DOT_CLASS[model.tone]}`}
            aria-hidden="true"
          />
          {model.headline}
        </span>
      }
      support={
        <>
          <SupportLine model={model} />
          {model.lastKnown && (
            <div className="mt-1 text-warning-600">
              <span>{model.lastKnown.summary}</span>{' '}
              <span>{`${model.lastKnown.evidenceLabel} ${model.lastKnown.evidenceAt}`}</span>
            </div>
          )}
        </>
      }
      detail={<NodeDetail model={model} />}
    />
  );
};

/** Retained for callers formatting a network name outside this card. */
export { formatNetworkTitle };

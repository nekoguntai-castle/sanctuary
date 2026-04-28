import React from "react";
import {
  Trash2,
  Edit2,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  Clock,
} from "lucide-react";
import { ElectrumServer } from "../../types";
import * as bitcoinApi from "../../src/api/bitcoin";
import { HealthHistoryBlocks } from "./HealthHistoryBlocks";
import {
  getFallbackHealthBlockClass,
  getFallbackHealthTitle,
  getHealthIndicatorClass,
  getProtocolBadgeClass,
  getServerRowClass,
  isServerCoolingDown,
} from "./serverRowModel";

interface ServerRowProps {
  server: ElectrumServer;
  index: number;
  totalServers: number;
  serverTestStatus: "idle" | "testing" | "success" | "error";
  serverActionLoading: string | null;
  serverPoolStats?: bitcoinApi.ServerStats;
  onTestServer: (server: ElectrumServer) => void;
  onToggleServer: (server: ElectrumServer) => void;
  onMoveServer: (serverId: string, direction: "up" | "down") => void;
  onEditServer: (server: ElectrumServer) => void;
  onDeleteServer: (serverId: string) => void;
}

type MoveDirection = "up" | "down";
type ServerSummaryProps = Pick<
  ServerRowProps,
  "server" | "serverTestStatus" | "serverPoolStats"
>;
type ServerActionsProps = Omit<ServerRowProps, "serverPoolStats">;

const FALLBACK_HEALTH_BLOCKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const ACTION_BUTTON_CLASS =
  "p-1.5 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800";
const MOVE_BUTTON_CLASS = `${ACTION_BUTTON_CLASS} disabled:opacity-30 disabled:cursor-not-allowed`;
const DELETE_BUTTON_CLASS =
  "p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-sanctuary-400 hover:text-red-500 dark:hover:text-red-400";

interface ActionButtonProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  title,
  children,
  className = ACTION_BUTTON_CLASS,
  disabled,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={className}
    disabled={disabled}
    title={title}
  >
    {children}
  </button>
);

const ServerSummary: React.FC<ServerSummaryProps> = ({
  server,
  serverTestStatus,
  serverPoolStats,
}) => (
  <div className="flex items-center space-x-3 min-w-0 flex-1">
    <div
      className={`w-2 h-2 rounded-full flex-shrink-0 ${getHealthIndicatorClass(
        serverTestStatus,
        server.isHealthy,
      )}`}
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center space-x-2">
        <span className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate">
          {server.label}
        </span>
        <span
          className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${getProtocolBadgeClass(
            server.useSsl,
          )}`}
        >
          {server.useSsl ? "SSL" : "TCP"}
        </span>
      </div>
      <span className="text-xs text-sanctuary-500">
        {server.host}:{server.port}
      </span>
      <ServerHealthDetails server={server} serverPoolStats={serverPoolStats} />
    </div>
  </div>
);

const ServerHealthDetails: React.FC<
  Pick<ServerSummaryProps, "server" | "serverPoolStats">
> = ({ server, serverPoolStats }) => {
  const healthHistory = serverPoolStats?.healthHistory;
  const consecutiveFailures = serverPoolStats?.consecutiveFailures;
  const weight = serverPoolStats?.weight;

  return (
    <div className="flex flex-col space-y-1 mt-1">
      {healthHistory && healthHistory.length > 0 ? (
        <HealthHistoryBlocks history={healthHistory} maxBlocks={10} />
      ) : (
        <FallbackHealthBlocks server={server} />
      )}
      <div className="flex items-center space-x-2 text-[10px] text-sanctuary-400">
        {server.lastHealthCheck && (
          <span>
            {new Date(server.lastHealthCheck).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {consecutiveFailures !== undefined && consecutiveFailures > 0 && (
          <span className="text-amber-500">
            {consecutiveFailures} fail{consecutiveFailures > 1 ? "s" : ""}
          </span>
        )}
        {weight !== undefined && weight < 1.0 && (
          <span className="text-amber-500">{Math.round(weight * 100)}%</span>
        )}
        {isServerCoolingDown(serverPoolStats) && (
          <span className="flex items-center space-x-0.5 text-rose-500">
            <Clock className="w-2.5 h-2.5" />
            <span>cooldown</span>
          </span>
        )}
      </div>
    </div>
  );
};

const FallbackHealthBlocks: React.FC<Pick<ServerRowProps, "server">> = ({
  server,
}) => {
  const failCount = server.healthCheckFails ?? 0;
  const hasHealthData = server.lastHealthCheck !== null;

  return (
    <div
      className="flex items-center space-x-0.5"
      title={getFallbackHealthTitle(server.lastHealthCheck)}
    >
      {FALLBACK_HEALTH_BLOCKS.map((blockIndex) => (
        <div
          key={blockIndex}
          className={`w-1.5 h-3 rounded-sm ${getFallbackHealthBlockClass(
            hasHealthData,
            blockIndex < failCount,
          )}`}
        />
      ))}
    </div>
  );
};

const ServerActions: React.FC<ServerActionsProps> = ({
  server,
  index,
  totalServers,
  serverTestStatus,
  serverActionLoading,
  onTestServer,
  onToggleServer,
  onMoveServer,
  onEditServer,
  onDeleteServer,
}) => (
  <div className="flex items-center space-x-1 flex-shrink-0">
    {serverTestStatus === "success" && (
      <CheckCircle className="w-4 h-4 text-emerald-500" />
    )}
    {serverTestStatus === "error" && (
      <XCircle className="w-4 h-4 text-rose-500" />
    )}
    <ActionButton
      title="Test connection"
      disabled={serverTestStatus === "testing"}
      onClick={() => onTestServer(server)}
    >
      {serverTestStatus === "testing" ? (
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
      ) : (
        <RefreshCw className="w-4 h-4 text-sanctuary-400" />
      )}
    </ActionButton>
    <ActionButton
      title={server.enabled ? "Disable server" : "Enable server"}
      onClick={() => onToggleServer(server)}
    >
      {server.enabled ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <XCircle className="w-4 h-4 text-sanctuary-400" />
      )}
    </ActionButton>
    <MoveServerButton
      serverId={server.id}
      direction="up"
      disabled={index === 0}
      onMoveServer={onMoveServer}
    />
    <MoveServerButton
      serverId={server.id}
      direction="down"
      disabled={index === totalServers - 1}
      onMoveServer={onMoveServer}
    />
    <ActionButton title="Edit server" onClick={() => onEditServer(server)}>
      <Edit2 className="w-4 h-4 text-sanctuary-400" />
    </ActionButton>
    <ActionButton
      title="Delete server"
      className={DELETE_BUTTON_CLASS}
      disabled={serverActionLoading === server.id}
      onClick={() => onDeleteServer(server.id)}
    >
      {serverActionLoading === server.id ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Trash2 className="w-4 h-4" />
      )}
    </ActionButton>
  </div>
);

interface MoveServerButtonProps {
  serverId: string;
  direction: MoveDirection;
  disabled: boolean;
  onMoveServer: (serverId: string, direction: MoveDirection) => void;
}

const MoveServerButton: React.FC<MoveServerButtonProps> = ({
  serverId,
  direction,
  disabled,
  onMoveServer,
}) => {
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const title =
    direction === "up"
      ? "Move up (higher priority)"
      : "Move down (lower priority)";

  return (
    <ActionButton
      title={title}
      onClick={() => onMoveServer(serverId, direction)}
      disabled={disabled}
      className={MOVE_BUTTON_CLASS}
    >
      <Icon className="w-4 h-4 text-sanctuary-400" />
    </ActionButton>
  );
};

export const ServerRow: React.FC<ServerRowProps> = ({
  server,
  index,
  totalServers,
  serverTestStatus,
  serverActionLoading,
  serverPoolStats,
  onTestServer,
  onToggleServer,
  onMoveServer,
  onEditServer,
  onDeleteServer,
}) => (
  <div className={`p-3 rounded-lg border ${getServerRowClass(server.enabled)}`}>
    <div className="flex items-center justify-between">
      <ServerSummary
        server={server}
        serverTestStatus={serverTestStatus}
        serverPoolStats={serverPoolStats}
      />
      <ServerActions
        server={server}
        index={index}
        totalServers={totalServers}
        serverTestStatus={serverTestStatus}
        serverActionLoading={serverActionLoading}
        onTestServer={onTestServer}
        onToggleServer={onToggleServer}
        onMoveServer={onMoveServer}
        onEditServer={onEditServer}
        onDeleteServer={onDeleteServer}
      />
    </div>
  </div>
);

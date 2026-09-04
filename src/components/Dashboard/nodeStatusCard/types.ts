/**
 * Node Status card presentation model types.
 *
 * `NodeStatusCardInput` extends the data-side `NodeStatusQueryState` with the
 * `selectedNetwork` the presenter needs to detect a mismatched/placeholder
 * response.
 */

import type { BitcoinDashboardNetwork } from '../../../api/bitcoin';
import type { NodeStatusQueryState } from '../hooks/dashboardDataModel';

export type NodeStatusTone = 'neutral' | 'checking' | 'success' | 'warning' | 'error';

export interface NodeStatusBadge {
  label: string;
  kind: 'network' | 'strategy';
}

export interface NodeStatusSupportItem {
  key: string;
  label?: string;
  value: string;
  tone?: NodeStatusTone;
  title?: string;
}

export type NodeStatusServerRole = 'Primary' | 'In use' | 'Next' | 'Standby' | null;
export type NodeStatusServerAvailabilityText = 'Online' | 'Offline' | 'Cooldown' | 'Not checked' | 'Stale';

export interface NodeStatusServerRow {
  serverId: string;
  label: string;
  host: string;
  port: number;
  role: NodeStatusServerRole;
  availability: NodeStatusServerAvailabilityText;
  tone: NodeStatusTone;
}

export type NodeStatusDetail =
  | { kind: 'none' }
  | { kind: 'guidance'; text: string }
  | { kind: 'servers'; rows: NodeStatusServerRow[]; guidance?: string };

export interface NodeStatusLastKnown {
  summary: string;
  evidenceLabel: 'observed' | 'attempted' | 'received';
  evidenceAt: string;
}

export interface NodeStatusCardModel {
  badges: NodeStatusBadge[];
  headline: string;
  tone: NodeStatusTone;
  support: NodeStatusSupportItem[];
  detail: NodeStatusDetail;
  lastKnown: NodeStatusLastKnown | null;
}

/**
 * The data-side `NodeStatusQueryState`, plus the `selectedNetwork` the
 * presenter needs to detect a mismatched/placeholder response.
 */
export interface NodeStatusCardInput extends NodeStatusQueryState {
  selectedNetwork: BitcoinDashboardNetwork;
}

/** Alias matching the contract's exported name for downstream integration. */
export type NodeStatusCardModelInput = NodeStatusCardInput;

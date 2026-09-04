/**
 * Node Status card pure presentation model — barrel re-export.
 *
 * Implementation is split across `nodeStatusCard/*` modules (precedence
 * chain, balanced/failover copy builders, server-row/count derivation, and
 * shared text formatting) to stay under the repository's per-file size and
 * cyclomatic-complexity gates. See `docs/plans/dashboard-network-status-card-redesign.md`
 * section B2 for the behavioral contract this implements.
 */

export type {
  NodeStatusTone,
  NodeStatusBadge,
  NodeStatusSupportItem,
  NodeStatusServerRole,
  NodeStatusServerAvailabilityText,
  NodeStatusServerRow,
  NodeStatusDetail,
  NodeStatusLastKnown,
  NodeStatusCardModel,
  NodeStatusCardInput,
  NodeStatusCardModelInput,
} from './nodeStatusCard/types';

export { buildNodeStatusCardModel } from './nodeStatusCard/precedence';

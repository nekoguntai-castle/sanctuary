import { WorkerHeartbeatReader } from "../../workerHeartbeatRegistry";
import { registerShareableCollector } from "./registry";
import { workerFleetSnapshotSchema } from "../../workerHeartbeatRegistry";

registerShareableCollector("notificationWorkerFleet", {
  collect: () => new WorkerHeartbeatReader().read(),
  schema: workerFleetSnapshotSchema,
  sourceProcess: "redis_shared",
  sourceKind: "rolling_aggregate",
  authoritativeFor: ["worker_notification_capability"],
  notAuthoritativeFor: [
    "notification_queue",
    "effective_notification_configuration",
    "worker_delivery",
  ],
});

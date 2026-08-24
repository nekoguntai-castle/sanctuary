import { recordSubscriptionComparisonFailure } from "./subscriptionCoverageFailureRepository";
import { readSubscriptionCoverage } from "./subscriptionCoverageReadRepository";

export { recordSubscriptionComparisonFailure } from "./subscriptionCoverageFailureRepository";
export { readSubscriptionCoverage } from "./subscriptionCoverageReadRepository";
export type {
  NetworkSubscriptionCoverageSnapshot,
  RecordSubscriptionComparisonFailureInput,
  RecordSubscriptionComparisonFailureResult,
  SubscriptionCoverageReadResult,
  SubscriptionCoverageReason,
} from "./subscriptionCoverageTypes";

export const subscriptionCoverageRepository = {
  recordSubscriptionComparisonFailure,
  readSubscriptionCoverage,
};

export default subscriptionCoverageRepository;

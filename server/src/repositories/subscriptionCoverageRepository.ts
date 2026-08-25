import { recordSubscriptionComparisonFailure } from "./subscriptionCoverageFailureRepository";
import {
  readSubscriptionCoverage,
  readSubscriptionCoverageWithClient,
} from "./subscriptionCoverageReadRepository";

export { recordSubscriptionComparisonFailure } from "./subscriptionCoverageFailureRepository";
export {
  readSubscriptionCoverage,
  readSubscriptionCoverageWithClient,
} from "./subscriptionCoverageReadRepository";
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
  readSubscriptionCoverageWithClient,
};

export default subscriptionCoverageRepository;

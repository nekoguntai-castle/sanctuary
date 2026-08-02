import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS,
  NOTIFICATION_RETENTION_CONTRACT_VERSION,
  notificationRetentionJobOptions,
} from "../../../src/internal/notificationRetention";

describe("notification retention contract", () => {
  it("pins a versioned count policy for retained notification families", () => {
    expect(NOTIFICATION_RETENTION_CONTRACT_VERSION).toBe(1);
    expect(DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS).toEqual({
      removeOnComplete: 500,
      removeOnFail: 250,
    });
    expect(notificationRetentionJobOptions("draft")).toEqual(
      DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS,
    );
    expect(notificationRetentionJobOptions("consolidation")).toEqual(
      DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS,
    );
  });

  it("makes webhook retention immediate at enqueue time", () => {
    expect(notificationRetentionJobOptions("webhook")).toEqual({
      removeOnComplete: true,
      removeOnFail: true,
    });
  });
});

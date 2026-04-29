import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  toBullMqJobId,
  withBullMqSafeJobId,
} from "../../../src/jobs/bullMqJobIds";

describe("bullMqJobIds", () => {
  it("leaves already-safe job IDs unchanged", () => {
    expect(toBullMqJobId("custom-id")).toBe("custom-id");
  });

  it("encodes BullMQ reserved separators without losing the logical ID", () => {
    const logicalJobId = "sync:wallet-1:startup";
    const encoded = toBullMqJobId(logicalJobId);

    expect(encoded).toMatch(/^b64_/);
    expect(encoded).not.toContain(":");
    expect(Buffer.from(encoded.slice(4), "base64url").toString("utf8")).toBe(
      logicalJobId,
    );
  });

  it("copies options only when the custom job ID needs encoding", () => {
    const safeOptions = { jobId: "already-safe", delay: 100 };
    const unsafeOptions = { jobId: "sync:wallet-1", delay: 100 };

    expect(withBullMqSafeJobId(undefined)).toBeUndefined();
    expect(withBullMqSafeJobId(safeOptions)).toBe(safeOptions);
    expect(withBullMqSafeJobId(unsafeOptions)).toEqual({
      jobId: toBullMqJobId("sync:wallet-1"),
      delay: 100,
    });
  });
});

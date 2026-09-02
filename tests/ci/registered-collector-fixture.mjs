#!/usr/bin/env node
import { writeFileSync } from "node:fs";

if (process.env.SANCTUARY_COLLECTOR_STARTED_PATH) {
  writeFileSync(process.env.SANCTUARY_COLLECTOR_STARTED_PATH, "started\n", {
    flag: "wx",
  });
}
setInterval(() => {}, 1_000);

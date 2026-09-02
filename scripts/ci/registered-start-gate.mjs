#!/usr/bin/env node

import process from "node:process";

const token = process.env.SANCTUARY_COLLECTOR_START_TOKEN;
if (!token || !/^[a-f0-9]{64}$/.test(token)) {
  throw new Error("registered start gate requires a 256-bit token");
}

const timeout = setTimeout(() => {
  process.stderr.write("registered start gate timed out before registration\n");
  process.exit(70);
}, 30_000);
timeout.unref();

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 80 || input.includes("\n")) break;
}
clearTimeout(timeout);
delete process.env.SANCTUARY_COLLECTOR_START_TOKEN;

if (input !== `registered ${token}\n`) {
  throw new Error(
    "registered start gate closed without exact registration authorization",
  );
}

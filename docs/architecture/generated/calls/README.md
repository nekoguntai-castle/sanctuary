---
title: Function-Level Call Graphs
sidebar_label: Function-level calls
description: Entry points for opt-in function-level call graphs.
---

# Function-Level Call Graphs

These pages show call relationships inside explicitly configured subsystems. They are intentionally narrower than whole-repository import graphs: a subsystem only includes files listed in [`calls.config.json`](https://github.com/nekoguntai-castle/sanctuary/blob/main/docs/architecture/calls.config.json).

Use these graphs to make new entry points visible in review. If a caller outside the configured file set becomes part of a tracked pipeline, add that file to the subsystem config and regenerate with `npm run arch:calls`.

## Graphs

- [Notification Dispatch](notifications.md) - all configured paths through which Sanctuary delivers Telegram, push, and AI insight notifications.

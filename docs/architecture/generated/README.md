---
title: Generated Architecture Appendices
sidebar_label: Generated appendices
description: Entry points for auto-generated module dependency graphs.
---

# Generated Architecture Appendices

These pages are drift artifacts, not primary explanations. Use the C4 pages first, then use these graphs to check whether imports still match the intended boundaries.

The generated diagrams are collapsed by directory so large packages stay navigable. Blank nodes inside a collapsed group represent files hidden by the collapse rule; they are useful for dependency shape, not for prose-level design review.

## Module Graphs

- [Frontend module graph](frontend.md) - React/Vite app, hooks, API client, theme, and shared frontend boundaries.
- [Server module graph](server.md) - backend API, services, repositories, workers, infrastructure, and shared server boundaries.
- [Gateway module graph](gateway.md) - mobile API gateway routing, middleware, push, and backend-event boundaries.

## Function-Level Call Graphs

- [Function-level call graph index](calls/README.md) - opt-in subsystem call graphs generated from TypeScript ASTs.

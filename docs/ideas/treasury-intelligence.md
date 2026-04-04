# Treasury Intelligence ("On-Chain CFO")

## Problem

Sanctuary has powerful data (UTXO sets, fee history, spending patterns, transaction history) but no way to proactively surface insights from it. Users must manually analyze their treasury health. The AI container exists but only does label suggestions and basic NLP queries.

## Value Proposition

- Proactive, not reactive — watches your wallets 24/7 and alerts you to opportunities and risks
- Contextual — knows ALL your wallets, UTXOs, spending patterns, vault policies
- Sovereign — runs on YOUR infrastructure, YOUR LLM (Ollama — local or on your own remote GPU server), no data leaves your network
- Bridges the gap between "I have a wallet" and "I have a treasury strategy"

## Analysis Pipelines

### 1. UTXO Health Scoring
"You have 847 dust UTXOs. At current fee rates, consolidating now costs 12,400 sats. If fees rise to last month's levels, it'll cost 94,000 sats. Consolidate now?"

### 2. Fee Timing Advisor
"Your 0.5 BTC send isn't urgent. Fees typically drop 60% on Sunday mornings. Shall I draft it for then?"
"Fee rate just hit a 30-day low. You have 3 pending consolidations — now is optimal."

### 3. Anomaly Detection
"Your daily spending velocity is 3x your 90-day average. This would have triggered a vault policy alert if one were configured."

### 4. Tax Intelligence
"Spending this UTXO triggers a short-term capital gain of ~$2,400. This other UTXO has equivalent value but is long-term. Use that instead?"

### 5. Consolidation Strategist
"At current growth rate, your wallet will have 500+ UTXOs in 6 months. Here's a gradual consolidation plan that minimizes fee exposure and privacy leakage."

## Key Requirements

1. **Ollama-compatible LLMs only** — No cloud AI (OpenAI, Anthropic, etc.). Supports three deployment modes:
   - **Bundled**: Ollama container running alongside Sanctuary in Docker
   - **Host-local**: Ollama installed on the host machine (e.g., for direct GPU access)
   - **Remote/Off-box**: Ollama on a dedicated GPU server on the LAN (e.g., `http://gpu-server:11434`)
2. **Separate notifications** — AI insights have their own Telegram message format and don't clog existing transaction notifications.
3. **Dedicated UI tab** — "Intelligence" tab with Insights feed, Chat, and Settings sub-tabs.
4. **Invisible unless enabled** — Zero trace of the feature if AI is disabled or unconfigured.

## Existing Building Blocks

- **Treasury Autopilot** (Phase 1): Already monitors fee rates and UTXO health every 10 minutes
- **AI Container**: Isolated, sandboxed, Ollama integration working
- **Notification Channel Registry**: Pluggable architecture, easy to add new channel
- **BullMQ Worker**: Cron-style job scheduling with distributed locking
- **Feature Flag System**: Runtime toggleable with dynamic job scheduling

## Architecture Summary

- New feature flag: `treasuryIntelligence` (separate from `aiAssistant` and `treasuryAutopilot`)
- 3 new DB tables: `AIInsight`, `AIConversation`, `AIMessage`
- New AI proxy endpoints: `/analyze` (background analysis), `/chat` (interactive conversation)
- New notification channel: `ai-insights` with distinct Telegram formatting
- Background analysis job runs every 30 minutes with deduplication and cooldowns
- New top-level "Intelligence" tab with Insights, Chat, and Settings sub-tabs

## Implementation Status

Initial implementation completed 2026-04-03. All 6 phases implemented:
1. Feature flags + Prisma schema + Repository
2. Analysis backend (internal endpoints, AI proxy, intelligence service)
3. Notification channel for AI insights (separate from transaction notifications)
4. Worker jobs (30-min analysis cycle, daily cleanup)
5. API routes (status, insights, conversations, settings)
6. Frontend Intelligence tab (Insights, Chat, Settings sub-tabs)

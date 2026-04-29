# AI Settings, Sanctuary Console, And MCP Access

Sanctuary now has two AI access paths:

- **Sanctuary Console** is the recommended path for most users. It runs inside the authenticated web app, sends prompts through the AI proxy, and lets the backend execute approved read-only Sanctuary tools.
- **Direct MCP access** is the advanced path for local clients, MCP Inspector, or a trusted LLM on another machine. It uses scoped bearer keys and should stay loopback-only unless you provide a trusted TLS, VPN, or reverse-proxy boundary.

Both paths are read-only in this release. They can answer questions about wallets, transactions, UTXOs, addresses, labels, policies, drafts, fees, prices, insights, and admin operations where the user or MCP key is authorized. They cannot spend, sign, create drafts, edit labels, change policies, run shell commands, or run arbitrary SQL.

## Prerequisites

1. Start Sanctuary and the AI runtime you trust:

   ```bash
   ./start.sh
   ollama serve
   # In another terminal:
   ollama pull llama3.2:3b
   ```

   Sanctuary no longer starts a model runtime container. Use host-installed Ollama, a desktop app such as LM Studio, a LAN OpenAI-compatible server, or an explicitly allowlisted cloud endpoint.

2. Enable feature flags in **Administration -> Feature Flags**:
   - `aiAssistant` for **Administration -> AI Settings** and provider configuration.
   - `sanctuaryConsole` for the in-app Console backend and drawer.

3. For direct MCP clients, start the MCP profile too:

   ```bash
   ./start.sh --with-mcp
   ```

   The default MCP endpoint is `http://127.0.0.1:3003/mcp`.

## Configure A Trusted Model Provider

Open **Administration -> AI Settings**.

1. In **Status**, enable AI features.
2. In **Settings**, configure the active provider profile:
   - **Host Ollama:** `http://host.docker.internal:11434`
   - **LAN Ollama/OpenAI-compatible:** for example `http://192.168.1.20:11434` or an LM Studio `/v1` endpoint such as `http://192.168.1.20:1234/v1`
   - **Cloud OpenAI-compatible:** use HTTPS and explicitly allowlist the provider endpoint in the AI proxy environment.
3. Set the model name, provider type, and capability flags.
4. Enter an API key only when the provider requires it. API keys are write-only: Sanctuary stores encrypted credential material and later shows only credential status.
5. Save the provider profile and run the connection test.
6. Use **Models** to view detected provider models. Sanctuary can pull/delete models for Ollama; LM Studio and other OpenAI-compatible providers manage downloads in their own app.

Provider credentials are not returned in settings responses, support packages, logs, or backups. After a backup restore, restored AI provider credentials are disabled and must be re-entered in **AI Settings**.

## Use Sanctuary Console

Open the Console from the compact brain icon directly under **Dashboard** in the left sidebar. The default keyboard shortcut is `Ctrl+Shift+.` on Windows/Linux and `Cmd+Shift+.` on macOS.

In the drawer:

1. Choose **General** scope for network, fee, price, node, and app-status questions, or choose a wallet scope for wallet-specific questions.
2. Ask a question, such as:
   - `How long ago was block 840000?`
   - `Summarize pending transactions for this wallet.`
   - `Which UTXOs look expensive to spend right now?`
   - `Show recent draft activity and policy warnings.`
3. Review tool traces under the answer. Traces show which backend read tools ran, whether results were redacted, and whether the result set was truncated.
4. Use prompt history to search, replay, save or unsave, delete, and set or clear a 30-day expiration on prompts.

Replay runs the prompt against current data, current permissions, and the current provider profile. Prompt history stores prompts and metadata, not raw high-sensitivity tool payloads.

The Console is not an operating-system terminal. It is a chat-style investigation surface backed by a fixed registry of Sanctuary read tools.

## Manage Direct MCP Keys

Open **Administration -> AI Settings -> MCP Access**.

Use this tab to:

- Confirm the MCP server status, base URL, protocol version, rate-limit metadata, and default page/window sizes.
- Create scoped MCP keys for a target user.
- Restrict keys to specific wallet IDs when a LAN client should not see every wallet available to that user.
- Set an expiration date for temporary clients.
- Grant audit-log read access only for admin users who need it.
- Copy the one-time `mcp_...` token immediately after creation.
- List active, expired, and revoked key metadata.
- Revoke keys without needing to restart the MCP server.

The full MCP token is shown once. Later inventory views expose only prefix metadata.

For client setup, transport headers, loopback/LAN binding, and MCP Inspector examples, see [MCP Server](mcp-server.md).

## Choose The Right Path

| Use case                                                          | Recommended path                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Normal wallet or transaction Q&A while using Sanctuary            | Sanctuary Console                                                       |
| Asking general chain, fee, price, node, or app-status questions   | Sanctuary Console with General scope                                    |
| Long-lived saved prompts and replay inside the app                | Sanctuary Console                                                       |
| External MCP client on the same machine                           | Direct MCP over loopback                                                |
| Trusted LLM or agent on another LAN machine                       | Direct MCP only behind TLS/VPN/reverse proxy with scoped, expiring keys |
| Public internet access                                            | Not supported                                                           |
| Spending, signing, label edits, wallet changes, or policy changes | Not supported in this release                                           |

## Security Boundaries

- The browser never sends a JWT, MCP token, or provider API key to the model.
- The LLM never receives shell, SQL, signing, descriptor, xpub, PSBT, or bearer-token access.
- Backend services validate the authenticated user or MCP key before every tool execution.
- Wallet-scoped Console sessions and MCP keys are rechecked at execution time.
- Fee and price reads use existing caches; read tools do not fetch external services on cache miss.
- Direct LAN MCP should be treated as advanced because bearer tokens and wallet metadata cross the network.
- Restored MCP keys are forced revoked, so old bearer tokens cannot silently work on a restored node.

## Release Proof Checklist

Before advertising AI/MCP/Console in a release candidate, verify:

- `aiAssistant` and `sanctuaryConsole` feature flags can be enabled by an admin.
- A provider profile can be saved, selected as active, tested, and updated without exposing credentials.
- The Console opens from the sidebar and shortcut, runs at least one General-scope prompt, and shows tool traces.
- Prompt history can be searched, replayed, saved, deleted, and given or cleared of a 30-day expiration.
- The MCP service starts with `./start.sh --with-mcp`.
- An admin can create, copy, list, and revoke an MCP key from **AI Settings -> MCP Access**.
- MCP Inspector or an SDK client can call `POST /mcp` with a scoped key over loopback.
- LAN MCP documentation is followed only with TLS, VPN, or reverse-proxy protection.
- Backup restore warnings tell admins to regenerate MCP keys and re-enter AI provider credentials.

# File Modularization Plan

Systematic plan to break large files (>500 lines) into focused modules per CLAUDE.md guidelines.
Each phase is independent and can be tackled in a separate worktree/session.

---

## Phase 1: Frontend Components (Critical — 500+ lines)

### 1A. `components/DeviceDetail.tsx` (1,791 lines)

**Current structure:** Monolithic component with two tabs (details/access), inline USB/QR/file/manual account import flows, sharing logic, transfer ownership.

**Already extracted:** `DeviceDetail/ManualAccountForm.tsx`, `DeviceDetail/AccountList.tsx`, `DeviceDetail/accountTypes.ts`

**Target structure:**
```
components/DeviceDetail/
├── index.ts                    # Re-export DeviceDetail
├── DeviceDetail.tsx            # Main orchestrator (~200 lines) - state, tab switching, data fetching
├── hooks/
│   └── useDeviceData.ts        # Data fetching, save, edit state
├── tabs/
│   ├── DetailsTab.tsx          # Device info display, wallet list, account list
│   └── AccessTab.tsx           # Ownership/sharing/transfers sub-tabs
├── access/
│   ├── OwnershipSection.tsx    # Owner info display
│   ├── SharingSection.tsx      # User search, group sharing, remove access
│   └── TransfersSection.tsx    # PendingTransfersPanel wrapper
├── accounts/
│   ├── AddAccountFlow.tsx      # Method selection + dispatch to USB/QR/file/manual
│   ├── UsbImport.tsx           # USB connection flow + progress
│   ├── QrImport.tsx            # Camera/file QR scanning, UR decoding
│   ├── FileImport.tsx          # SD card file upload + parsing
│   ├── ManualAccountForm.tsx   # (already exists)
│   ├── AccountList.tsx         # (already exists)
│   ├── ImportReview.tsx        # Parsed account selection + conflict display
│   └── urHelpers.ts            # extractFromUrResult, normalizeDerivationPath, extractFingerprint
└── accountTypes.ts             # (already exists)
```

---

### 1B. `components/ImportWallet.tsx` (1,361 lines)

**Current structure:** Multi-format import wizard (descriptor/JSON/hardware/QR), device resolution, conflict handling.

**Target structure:**
```
components/ImportWallet/
├── index.ts
├── ImportWallet.tsx             # Wizard orchestrator, step management (~250 lines)
├── hooks/
│   └── useImportState.ts        # All import state + reset logic
├── steps/
│   ├── FormatSelection.tsx      # Choose import format (descriptor/JSON/QR/hardware)
│   ├── DescriptorInput.tsx      # Paste descriptor text input
│   ├── JsonInput.tsx            # Paste/upload JSON config
│   ├── QrScanStep.tsx           # QR camera/file scanning
│   └── HardwareImport.tsx       # USB hardware wallet import
├── DeviceResolution.tsx         # Map imported xpubs to devices, conflict handling
├── ImportReview.tsx             # Final review before creating wallet
└── importHelpers.ts             # Parsing utilities, format detection
```

---

### 1C. `components/Settings.tsx` (1,311 lines)

**Current structure:** Single page with many settings sections (currency, theme, background, sound, Telegram, privacy, display).

**Target structure:**
```
components/Settings/
├── index.ts
├── Settings.tsx                 # Tab/section layout orchestrator (~150 lines)
├── hooks/
│   └── useSettings.ts           # Settings fetch/save, state management
├── sections/
│   ├── CurrencySection.tsx      # Currency + display preferences
│   ├── ThemeSection.tsx         # Theme + background animation picker
│   ├── SoundSection.tsx         # Sound preset selection + preview
│   ├── TelegramSection.tsx      # Telegram bot config + test
│   ├── PrivacySection.tsx       # Privacy toggles
│   └── DisplaySection.tsx       # Server display, advanced preferences
└── components/
    └── SettingRow.tsx            # Reusable setting row layout (if pattern repeats)
```

---

### 1D. `components/AISettings.tsx` (1,224 lines)

**Current structure:** Already tabbed (status/settings/models), but all tab content is inline.

**Target structure:**
```
components/AISettings/
├── index.ts
├── AISettings.tsx               # Tab orchestrator (~150 lines)
├── hooks/
│   └── useAIStatus.ts           # Health polling, status state
├── tabs/
│   ├── StatusTab.tsx            # AI service status display
│   ├── SettingsTab.tsx          # AI endpoint config, container management
│   └── ModelsTab.tsx            # Model list, download progress, delete
└── components/
    └── ContainerControls.tsx     # Start/stop/restart Ollama container
```

---

### 1E. `components/Dashboard.tsx` (1,041 lines)

**Target structure:**
```
components/Dashboard/
├── index.ts
├── Dashboard.tsx                # Layout + WebSocket subscriptions (~200 lines)
├── WalletSummary.tsx            # Wallet cards grid
├── PriceChart.tsx               # Price chart with animated transitions
├── MempoolSection.tsx           # Mempool block visualizer wrapper
├── RecentTransactions.tsx       # Recent transaction list
└── hooks/
    └── useDashboardData.ts      # Data fetching + WebSocket event handling
```

---

### 1F. `components/send/steps/ReviewStep.tsx` (924 lines)

**Target structure:**
```
components/send/steps/
├── ReviewStep.tsx               # Review orchestrator (~250 lines)
├── review/
│   ├── TransactionSummary.tsx   # Inputs/outputs/fee display
│   ├── SigningFlow.tsx          # Device signing dispatch
│   ├── UsbSigning.tsx          # USB hardware wallet signing
│   ├── QrSigning.tsx           # QR/airgap signing flow
│   └── DraftActions.tsx         # Save draft, broadcast buttons
```

---

### 1G. `components/BackupRestore.tsx` (916 lines)

**Target structure:**
```
components/BackupRestore/
├── index.ts
├── BackupRestore.tsx            # Page layout + tab switching (~150 lines)
├── BackupPanel.tsx              # Create backup, format selection, download
├── RestorePanel.tsx             # Upload, validate, confirm restore
├── BackupHistory.tsx            # List previous backups
└── EncryptionKeyDisplay.tsx     # Encryption key reveal/copy
```

---

### 1H. `components/TransactionList.tsx` (906 lines)

**Target structure:**
```
components/TransactionList/
├── index.ts
├── TransactionList.tsx          # Virtualized list container (~200 lines)
├── TransactionRow.tsx           # Single row rendering
├── LabelEditor.tsx              # Inline label editing + AI suggestions
├── ActionMenu.tsx               # RBF/CPFP/explorer context menu
├── FlowPreview.tsx              # Transaction flow visualization
└── hooks/
    └── useTransactionList.ts    # Pagination, filtering, sorting state
```

---

### 1I. Other frontend (500-900 lines, lower priority)

| File | Lines | Split approach |
|------|------:|----------------|
| `NetworkConnectionCard.tsx` (857) | Extract server health blocks, inline editing, pool stats |
| `Layout.tsx` (781) | Extract sidebar nav, about modal, header |
| `BlockVisualizer.tsx` (779) | Extract block rendering, fee bar, tooltip |
| `send/steps/OutputsStep.tsx` (774) | Extract recipient list, coin control, fee selector |
| `NodeConfig.tsx` (758) | Extract per-section components |
| `DraftList.tsx` (742) | Extract draft row, flow preview |
| `ElectrumServerSettings.tsx` (717) | Extract server row, health blocks |
| `Account.tsx` (701) | Extract password form, 2FA setup, backup codes |
| `WalletDetail.tsx` (665) | Extract tab switcher, action bar |
| `UsersGroups.tsx` (603) | Extract user CRUD, group CRUD panels |
| `AuditLogs.tsx` (595) | Extract filter bar, stat cards, log row |
| `WalletList.tsx` (549) | Extract grid view, table view, chart |
| `Monitoring.tsx` (539) | Extract service cards |
| `DeviceList.tsx` (519) | Extract list/grouped views |
| `ConnectDevice.tsx` (500) | Extract per-method flows |
| `CoinControlPanel.tsx` (491) | Extract UTXO row, strategy picker |
| `CreateWallet.tsx` (484) | Extract type selection, device picker |

---

## Phase 2: Backend Services (Critical — 500+ lines)

### 2A. `server/src/services/bitcoin/electrumPool.ts` (2,104 lines)

**Target structure:**
```
services/bitcoin/electrumPool/
├── index.ts                     # Re-export ElectrumPool class
├── electrumPool.ts              # Core pool orchestrator (~400 lines)
├── connectionManager.ts         # Connection lifecycle, connect/disconnect
├── healthChecker.ts             # Per-server health checks, latency tracking
├── circuitBreaker.ts            # Circuit breaker state machine
├── acquisitionQueue.ts          # Connection acquisition queueing
├── serverSelector.ts            # Server selection strategy (priority, health-based)
└── types.ts                     # Pool config interfaces, server state types
```

---

### 2B. `server/src/services/bitcoin/transactionService.ts` (1,896 lines)

**Note:** Already re-exports from sub-files. Audit what's still inline vs delegated.

**Target:** Move remaining inline logic into focused modules:
```
services/bitcoin/transactions/
├── index.ts                     # Public API re-exports
├── psbtConstruction.ts          # PSBT building (if not already in psbtBuilder)
├── utxoSelection.ts             # UTXO picking (if not delegated to utxoSelectionService)
├── feeEstimation.ts             # Fee calculation logic
├── signing.ts                   # Signing coordination
├── broadcasting.ts              # Broadcast + confirmation tracking
└── types.ts                     # Transaction-specific types
```

---

### 2C. `server/src/services/syncService.ts` (1,236 lines)

**Target structure:**
```
services/sync/
├── index.ts
├── syncService.ts               # Public API, queue dispatch (~300 lines)
├── syncQueue.ts                 # Queue management, priority ordering
├── walletSync.ts                # Per-wallet sync orchestration
├── subscriptionManager.ts       # Electrum address/block subscriptions
└── types.ts
```

---

### 2D. `server/src/services/bitcoin/electrum.ts` (1,199 lines)

**Target structure:**
```
services/bitcoin/electrum/
├── index.ts
├── electrumClient.ts            # Public API, connection lifecycle (~300 lines)
├── protocol.ts                  # JSON-RPC framing, request/response
├── methods.ts                   # Address history, balance, UTXO, broadcast
├── connection.ts                # TCP/TLS socket, SOCKS proxy (Tor)
└── types.ts                     # Zod schemas for protocol responses
```

---

### 2E. `server/src/services/wallet.ts` (1,028 lines)

**Target structure:**
```
services/wallet/
├── index.ts
├── walletService.ts             # CRUD orchestrator (~250 lines)
├── addressGeneration.ts         # Address derivation + gap limit
├── accessControl.ts             # Role checking, permission validation
├── labelService.ts              # Label CRUD (or keep in separate service)
└── types.ts
```

---

### 2F. `server/src/services/walletImport.ts` (999 lines)

**Target structure:**
```
services/walletImport/
├── index.ts
├── walletImportService.ts       # Import orchestrator (~250 lines)
├── descriptorImport.ts          # Descriptor string parsing + wallet creation
├── jsonImport.ts                # JSON config parsing
├── deviceResolution.ts          # Fingerprint matching, conflict detection
└── types.ts
```

---

### 2G. `server/src/websocket/clientServer.ts` (983 lines)

**Target structure:**
```
websocket/
├── clientServer.ts              # Server setup, connection handling (~250 lines)
├── auth.ts                      # JWT verification, connection auth
├── channels.ts                  # Channel subscription/unsubscription logic
├── rateLimiter.ts               # Rate limiting with grace period
├── messageQueue.ts              # Bounded message queue per client
└── redisBroadcast.ts            # Cross-instance Redis pub/sub
```

---

### 2H. Other backend (500-900 lines, lower priority)

| File | Lines | Split approach |
|------|------:|----------------|
| `descriptorParser.ts` (916) | Extract single-sig/multisig/JSON parsers |
| `backupService.ts` (825) | Extract backup creation, restore, encryption |
| `transferService.ts` (788) | Extract initiate/accept/confirm flows |
| `openapi.ts` (788) | Extract schema definitions into separate files |
| `advancedTx.ts` (787) | Extract RBF, CPFP, batch into separate files |
| `electrumManager.ts` (767) | Extract subscription handling, reconnection |
| `blockchain.ts` (739) | Audit re-exports, extract remaining inline logic |
| `maintenanceService.ts` (720) | Extract per-task cleanup (audit, price, vacuum) |
| `addressDerivation.ts` (710) | Extract per-script-type derivation |
| `confirmations.ts` (696) | Extract batch update, milestone tracking |
| `processTransactions.ts` (683) | Extract classification, RBF detection |
| `aiService.ts` (662) | Extract config sync, health check |
| `mempool.ts` (660) | Extract per-endpoint methods |
| `docker.ts` (586) | Extract container discovery, health |
| `metrics.ts` (574) | Extract per-domain metric groups |
| `factory.ts` (569) | Consider splitting per-repository |
| `health.ts` (562) | Extract per-subsystem health checks |
| `workerJobQueue.ts` (552) | Extract queue definitions, retry logic |
| `notifications.ts` (549) | Extract per-event-type handlers |
| `psbtBuilder.ts` (547) | Extract BIP32 derivation, witness scripts |
| `eventService.ts` (525) | Extract per-event coordinators |
| `twoFactor.ts` (521) | Extract TOTP setup, backup codes |
| `walletTransactions.ts` (510) | Extract stats, pagination logic |
| `creation.ts` (509) | Extract PSBT creation, draft flow |
| `price/index.ts` (508) | Extract provider aggregation |
| `payjoinService.ts` (508) | Extract SSRF protection, proposal parsing |
| `devices/crud.ts` (508) | Extract conflict detection |
| `admin/nodeConfig.ts` (508) | Extract per-section config |
| `utxoSelectionService.ts` (506) | Extract per-strategy algorithms |
| `jobQueue.ts` (504) | Extract cron scheduling, retry |

---

## Phase 3: Hooks & API Clients

### 3A. `hooks/useSendTransactionActions.ts` (955 lines)

**Target structure:**
```
hooks/send/
├── useSendTransactionActions.ts  # Orchestrator (~200 lines)
├── useUsbSigning.ts              # USB hardware wallet signing
├── useQrSigning.ts               # QR/airgap signing
├── useDraftManagement.ts         # Draft save/load
├── usePayjoin.ts                 # Payjoin negotiation
└── useBroadcast.ts               # Transaction broadcasting
```

---

### 3B. `hooks/useQrScanner.ts` (508 lines)

**Target structure:**
```
hooks/qr/
├── useQrScanner.ts               # Public hook (~200 lines)
├── urDecoder.ts                  # UR/fountain code assembly
├── bbqrDecoder.ts                # BBQr multi-part assembly
└── types.ts
```

---

### 3C. `hooks/useWebSocket.ts` (498 lines)

Borderline — monitor but likely fine as-is.

---

### 3D. `hooks/soundPresets.ts` (843 lines)

Data-heavy preset definitions. Consider splitting each preset into its own file only if adding new presets becomes frequent. Low priority.

---

### 3E. `src/api/admin.ts` (686 lines) & `src/api/transactions.ts` (542 lines)

Split by domain:
```
src/api/admin/
├── index.ts        # Re-exports
├── users.ts        # User CRUD calls
├── groups.ts       # Group CRUD calls
├── monitoring.ts   # Monitoring calls
├── backup.ts       # Backup/restore calls
├── ai.ts           # AI settings calls
└── types.ts        # Admin API types

src/api/transactions/
├── index.ts
├── transactions.ts  # Transaction CRUD
├── utxos.ts         # UTXO calls
├── privacy.ts       # Privacy analysis
└── types.ts
```

---

## Phase 4: Gateway & Shared

### 4A. `gateway/src/services/backendEvents.ts` (474 lines)

Borderline — extract push notification formatting if it grows.

### 4B. `shared/types/api.ts` (421 lines)

Borderline — split by domain (wallet types, transaction types, device types) if it grows past 500.

---

## Execution Guidelines

### Per-file checklist
1. Read the entire file, identify logical boundaries
2. Create the target directory structure
3. Extract types/interfaces first into `types.ts`
4. Extract pure helper functions (no React/state) into utility files
5. Extract sub-components/sub-services one at a time
6. Update the main file to import from new modules
7. Update all external imports (use grep to find all importers)
8. Run `tsc --noEmit` to verify no type errors
9. Run existing tests to verify no regressions
10. Run the app to smoke-test the affected feature

### Rules
- **No behavior changes** — pure refactoring only
- **Barrel files (`index.ts`)** must re-export the public API so external imports don't break
- **One PR per phase sub-item** (e.g., 1A, 1B) to keep reviews manageable
- **Animation files are excluded** — they're self-contained canvas renderers, not worth splitting
- Prioritize files that are actively being modified or causing merge conflicts

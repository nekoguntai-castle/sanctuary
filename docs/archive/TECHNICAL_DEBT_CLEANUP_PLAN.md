# Technical Debt Cleanup Plan

Created: 2026-01-22

This document outlines the implementation plan for cleaning up technical debt in the Sanctuary codebase. Execute phases in order.

---

## Phase 1: Remove/Gate Console Logging in Production Code

**Goal**: Remove debug console.log statements or gate them behind development mode checks.

### Files to Modify

#### 1.1 Frontend - High Priority (Production Debug Logging)

| File | Lines | Action |
|------|-------|--------|
| `hooks/useSendTransactionActions.ts` | 719, 745, 766, 768, 776, 799, 816, 819, 824 | Replace with `log.debug()` using existing `createLogger` |
| `components/send/steps/ReviewStep.tsx` | 318, 321, 326, 328, 337 | Replace with `log.debug()` |
| `components/send/steps/OutputsStep.tsx` | 241 | Replace with `log.warn()` |
| `components/qr/AnimatedQRCode.tsx` | 39 | Replace with `log.error()` |
| `hooks/useWebSocket.ts` | 261 | Replace with `log.warn()` |
| `services/bbqr.ts` | 79, 85 | Replace with `log.warn()` |

#### 1.2 Pattern to Follow

Each file should import and use the existing logger:
```typescript
import { createLogger } from '../utils/logger';
const log = createLogger('ComponentName');

// Replace:
console.log('[ReviewStep] message', data);
// With:
log.debug('message', data);

// Replace:
console.warn('warning message');
// With:
log.warn('warning message');

// Replace:
console.error('error message', err);
// With:
log.error('error message', err);
```

#### 1.3 Files That Are OK (Already Gated)

These use conditional logging and are acceptable:
- `services/websocket.ts` - Uses `isDev &&` check
- `utils/logger.ts` - Logger implementation itself
- `server/src/utils/logger.ts` - Server logger
- `server/src/config/index.ts` - Startup security warnings (intentional)
- `server/src/config/schema.ts` - Config validation errors (intentional)
- `server/prisma/seed.ts` - CLI script output (acceptable)
- `ai-proxy/src/index.ts` - Standalone service with prefixed logging (acceptable)
- All test files - Acceptable for tests

### 1.4 Implementation Steps

1. Create a branch: `git checkout -b cleanup/remove-console-logs`
2. For each file in 1.1:
   - Add `import { createLogger } from '../utils/logger';` if not present
   - Add `const log = createLogger('FileName');` if not present
   - Replace each console.log/warn/error with log.debug/warn/error
3. Run tests: `npm test`
4. Commit: "Remove console logging from production code"

---

## Phase 2: Restore Deleted Documentation

**Goal**: Restore valuable documentation files that were deleted.

### Files to Restore

```bash
# Run these commands to restore deleted docs:
git checkout HEAD -- docs/TECHNICAL_DEBT.md
git checkout HEAD -- docs/TEST_COVERAGE_ANALYSIS.md
git checkout HEAD -- docs/TEST_COVERAGE_DEEP_ANALYSIS.md
git checkout HEAD -- docs/TEST_COVERAGE_PLAN.md
git checkout HEAD -- docs/DEBUG-multisig-broadcast-failure.md
git checkout HEAD -- docs/LIGHTNING_INTEGRATION_OPTIONS.md
git checkout HEAD -- docs/TAPROOT_ASSETS_PLAN.md
git checkout HEAD -- docs/install-scripts-improvements.md
git checkout HEAD -- docs/plans/architecture-improvement-plan.md
git checkout HEAD -- docs/plans/ios-backend-enhancements.md
git checkout HEAD -- docs/plans/network-based-wallet-views.md
git checkout HEAD -- CLAUDE.md
git checkout HEAD -- PLAN-test-coverage-gaps.md
git checkout HEAD -- components/config/CLAUDE.md
git checkout HEAD -- scripts/verify-psbt/CLAUDE.md
```

### Alternative: Archive Instead

If these docs are intentionally being removed, move them to `docs/archive/` instead:
```bash
mkdir -p docs/archive
git mv docs/TECHNICAL_DEBT.md docs/archive/
# etc.
```

### Implementation Steps

1. Decide: restore or archive
2. If restoring: run git checkout commands above
3. If archiving: move to `docs/archive/` and update any references
4. Commit: "Restore deleted documentation" or "Archive legacy documentation"

---

## Phase 3: Split Large Components

**Goal**: Split oversized components into focused, maintainable sub-components.

### 3.1 WalletDetail.tsx (3174 lines -> ~500 lines each)

**Current Structure Analysis**:
- Lines 1-145: Imports + helper functions
- Lines 146-600: Main component state and hooks
- Lines 600-900: Event handlers (sync, delete, repair, etc.)
- Lines 900-1200: Access/sharing logic
- Lines 1200-1500: Header + badges UI
- Lines 1500-1650: Tabs navigation
- Lines 1650-2000: Transaction tab content
- Lines 2000-2200: UTXO tab content
- Lines 2200-2400: Addresses tab content
- Lines 2400-2700: Settings tab content
- Lines 2700-3000: Export modal
- Lines 3000-3174: Other modals (delete, receive, etc.)

**Proposed Split**:

```
components/WalletDetail/
├── index.tsx                    # Main component (~300 lines) - routing, state coordination
├── WalletHeader.tsx             # Header with badges, balance, actions (~200 lines)
├── WalletTabs.tsx               # Tab navigation component (~100 lines)
├── tabs/
│   ├── TransactionsTab.tsx      # Transaction list + AI query (~300 lines)
│   ├── UTXOsTab.tsx             # UTXO list + privacy scoring (~200 lines)
│   ├── AddressesTab.tsx         # Address list (~200 lines)
│   ├── DraftsTab.tsx            # Draft transactions (~100 lines)
│   ├── StatsTab.tsx             # Wallet statistics (~100 lines)
│   ├── AccessTab.tsx            # Sharing/permissions (~300 lines)
│   └── SettingsTab.tsx          # Settings with sub-tabs (~400 lines)
├── modals/
│   ├── ExportModal.tsx          # Export wallet modal (~300 lines)
│   ├── ReceiveModal.tsx         # Receive address modal (~150 lines)
│   └── DeleteModal.tsx          # Delete confirmation (~100 lines)
├── WalletTelegramSettings.tsx   # Already extracted - keep as is
└── LogTab.tsx                   # Already extracted - keep as is
```

**Shared State Pattern**:
```typescript
// components/WalletDetail/context.tsx
export const WalletDetailContext = React.createContext<{
  wallet: Wallet | null;
  syncing: boolean;
  handleSync: () => Promise<void>;
  handleFullResync: () => Promise<void>;
  // ... other shared state
} | null>(null);

export const useWalletDetail = () => {
  const context = useContext(WalletDetailContext);
  if (!context) throw new Error('Must be used within WalletDetailProvider');
  return context;
};
```

### 3.2 DeviceDetail.tsx (1852 lines -> ~400 lines each)

**Current Structure Analysis**:
- Lines 1-100: Imports + types
- Lines 100-400: Main component state
- Lines 400-600: USB/QR connection handlers
- Lines 600-900: Account parsing and import logic
- Lines 900-1200: Header UI + account list
- Lines 1200-1600: Add account modal (QR/USB/manual)
- Lines 1600-1852: Access tab + sharing

**Proposed Split**:

```
components/DeviceDetail/
├── index.tsx                    # Main component (~250 lines)
├── DeviceHeader.tsx             # Device info header (~200 lines)
├── AccountList.tsx              # List of device accounts (~200 lines)
├── tabs/
│   ├── DetailsTab.tsx           # Device details view (~150 lines)
│   └── AccessTab.tsx            # Sharing/permissions (~250 lines)
├── modals/
│   ├── AddAccountModal.tsx      # Add account modal container (~150 lines)
│   ├── QRAccountImport.tsx      # QR scanning for accounts (~300 lines)
│   ├── USBAccountImport.tsx     # USB connection for accounts (~200 lines)
│   └── ManualAccountForm.tsx    # Manual xpub entry (~150 lines)
└── hooks/
    └── useDeviceAccounts.ts     # Account import logic (~200 lines)
```

### 3.3 Implementation Steps

1. Create branch: `git checkout -b refactor/split-large-components`
2. Create directory structure for WalletDetail
3. Extract components one at a time, starting with modals (lowest risk)
4. Create context for shared state
5. Update imports in main component
6. Run tests after each extraction
7. Repeat for DeviceDetail
8. Final test run
9. Commit: "Split WalletDetail and DeviceDetail into sub-components"

### 3.4 Extraction Order (Lowest Risk First)

**WalletDetail**:
1. ExportModal (self-contained)
2. ReceiveModal (self-contained)
3. DeleteModal (self-contained)
4. WalletHeader (mostly presentational)
5. Individual tabs (one at a time)
6. Main component refactor

**DeviceDetail**:
1. ManualAccountForm (self-contained)
2. QRAccountImport (self-contained)
3. USBAccountImport (self-contained)
4. AddAccountModal (container)
5. AccountList
6. DeviceHeader
7. Main component refactor

---

## Phase 4: TypeScript Strict Mode + Error Logging

**Goal**: Enable stricter TypeScript and add error logging to silent catch blocks.

### 4.1 Enable Strict Mode in Frontend

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    // Add these:
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

**Warning**: This will likely surface many type errors. Implementation approach:
1. Enable one strict option at a time
2. Fix resulting errors
3. Move to next option
4. Order: `noImplicitAny` -> `strictNullChecks` -> rest

### 4.2 Add Error Logging to Empty Catch Blocks

**Files to Fix**:

| File | Line | Current | Fix |
|------|------|---------|-----|
| `server/src/services/bitcoin/electrumPool.ts` | 1595 | `catch {}` | `catch (e) { log.debug('disconnect cleanup failed', { error: e }); }` |
| `server/src/services/bitcoin/electrumPool.ts` | 1622 | `catch {}` | `catch (e) { log.debug('disconnect cleanup failed', { error: e }); }` |
| `server/src/services/bitcoin/electrumPool.ts` | 1683 | `catch {}` | `catch (e) { log.debug('cleanup failed', { error: e }); }` |
| `server/src/services/bitcoin/providers/index.ts` | 94 | `.catch(() => {})` | `.catch((e) => log.debug('provider disconnect failed', { error: e }))` |
| `server/src/infrastructure/redis.ts` | 147 | `.catch(() => {})` | `.catch((e) => log.debug('redis quit failed', { error: e }))` |

### 4.3 Fix @ts-ignore Directives

**File**: `server/src/services/backupService.ts` (lines 221, 439, 521)

Current:
```typescript
// @ts-ignore - Dynamic table access
const records = await prisma[tableName].findMany(...);
```

Fix with proper typing:
```typescript
type PrismaModels = keyof typeof prisma;

function getTableClient<T extends PrismaModels>(tableName: T) {
  return prisma[tableName];
}
```

**File**: `server/src/auditService.ts` (line 205)

Fix with Express type augmentation:
```typescript
// types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string; role: string };
    }
  }
}
```

### 4.4 Implementation Steps

1. Create branch: `git checkout -b refactor/typescript-strict`
2. Add error logging to empty catch blocks first (quick win)
3. Fix @ts-ignore directives
4. Enable `noImplicitAny` in frontend tsconfig
5. Fix resulting errors
6. Enable `strictNullChecks`
7. Fix resulting errors
8. Enable remaining strict options
9. Run full test suite
10. Commit: "Enable TypeScript strict mode and fix type safety issues"

---

## Summary: Execution Order

| Phase | Description | Estimated Scope | Dependencies |
|-------|-------------|-----------------|--------------|
| 1 | Remove console.log | ~6 files, ~30 changes | None |
| 2 | Restore/archive docs | Git operations only | None |
| 3 | Split components | ~20 new files, major refactor | Phase 1 (clean code) |
| 4 | TypeScript strict | Many files, type fixes | Phase 3 (stable components) |

### Git Branch Strategy

```bash
# Phase 1
git checkout -b cleanup/remove-console-logs
# ... work ...
git checkout main && git merge cleanup/remove-console-logs

# Phase 2
git checkout -b cleanup/restore-docs
# ... work ...
git checkout main && git merge cleanup/restore-docs

# Phase 3
git checkout -b refactor/split-large-components
# ... work ...
git checkout main && git merge refactor/split-large-components

# Phase 4
git checkout -b refactor/typescript-strict
# ... work ...
git checkout main && git merge refactor/typescript-strict
```

---

## Ongoing Maintenance Guidelines

After completing this cleanup:

1. **Keep components under 500 lines** - Split proactively
2. **No console.log in production code** - Use `createLogger` utility
3. **No empty catch blocks** - At minimum log at debug level
4. **No @ts-ignore** - Fix types properly or use `@ts-expect-error` with explanation
5. **Maintain strict TypeScript** - Don't disable strict checks
6. **Document architectural decisions** - Create ADRs for major changes

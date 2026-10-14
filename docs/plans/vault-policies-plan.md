# Vault Policies & Spending Governance Plan

Date: 2026-03-16
Owner: TBD
Status: Draft

---

## 1. Overview

Sanctuary currently coordinates Bitcoin wallets with role-based access and multisig signing. What it lacks is a **governance layer** — configurable rules that enforce organizational spending policies before transactions can proceed.

This plan introduces **Vault Policies**: a rule engine that sits between "someone wants to send Bitcoin" and "the transaction gets signed," enforcing spending limits, approval workflows, time delays, address controls, and velocity limits.

### Goals

1. **Organizational control** — Spending rules enforced by the server, not by trust.
2. **Separation of approval and signing** — Organizational approval is distinct from cryptographic signing. A CFO approves; a keyholder signs.
3. **Incremental adoption** — Wallets with no policies behave exactly as they do today. Zero disruption.
4. **Auditability** — Every policy evaluation, approval, rejection, and override is logged.
5. **Mobile parity** — Policies enforced identically whether the user is on web or mobile.

### Non-Goals (for now)

- On-chain enforcement (timelocks, miniscript) — this is server-side governance only.
- Cross-wallet policies (e.g., "total org spend across all wallets") — wallet-scoped only in v1.
- Automated transaction creation (scheduled sends) — governance only, not initiation.

---

## 2. New Concepts

### 2.1 The Approver Role

**Current roles:** Owner > Signer > Viewer

**Problem:** A Signer holds a hardware wallet key — that's a cryptographic capability. But organizational approval ("should we spend this?") is a separate responsibility. A CFO might approve a 50 BTC transaction but never touch a hardware wallet. A junior employee might hold a signing key in a 3-of-5 multisig but have no authority to approve large spends unilaterally.

**Solution:** Add **Approver** as a new wallet-level role.

```
Owner     — Full control. Can manage policies, approve, sign, share, delete.
Approver  — Can approve/reject transactions. Can view everything. Cannot sign.
Signer    — Can sign with hardware wallet. Can view everything. Cannot approve (unless also granted approval capability by Owner).
Viewer    — Read-only.
```

**Approver and Signer are peers, not hierarchical.** They represent orthogonal capabilities at the same authorization tier:

```
              Owner
             /     \
        Approver   Signer
             \     /
              Viewer
```

**Compound capability:** An Owner can grant `canApprove` to any Signer, making them both a signer and an approver. This uses the existing MobilePermissions capability pattern — no multi-role refactor needed.

**New capabilities added to the permission matrix:**

| Capability | Owner | Approver | Signer | Viewer |
|-----------|-------|----------|--------|--------|
| viewBalance | yes | yes | yes | yes |
| viewTransactions | yes | yes | yes | yes |
| createTransaction | yes | no | yes | no |
| signPsbt | yes | no | yes | no |
| broadcast | yes | no | yes | no |
| approveTransaction | yes | yes | no* | no |
| managePolicies | yes | no | no | no |
| manageDevices | yes | no | no | no |
| shareWallet | yes | no | no | no |
| deleteWallet | yes | no | no | no |

*Signers can be granted `canApprove` by Owner via permission override.

### 2.2 Vault Policies

A **VaultPolicy** is a named rule attached to a wallet that constrains how transactions can proceed.

**Policy types:**

| Type | What it does |
|------|-------------|
| `spending_limit` | Caps spending per transaction, per day, per week, or per month |
| `approval_required` | Requires N approvals from designated approvers before signing/broadcast |
| `time_delay` | Imposes a mandatory cooling period between approval and broadcast, during which any approver can veto |
| `address_control` | Restricts recipients to an allowlist, or blocks a denylist |
| `velocity` | Limits the number of transactions per time window |

**Policy attachment hierarchy:**

```
System-wide policies (set by admin, apply to ALL wallets)
    ↓ inherited by
Group default policies (set by admin, auto-apply when wallet joins group)
    ↓ inherited by
Wallet-specific policies (set by wallet Owner)
```

- **System policies** cannot be overridden or disabled by wallet owners. They are the organization's floor.
- **Group defaults** are copied to the wallet on assignment. The wallet owner can tighten them but not relax below system minimums.
- **Wallet policies** are the most specific. They can only be MORE restrictive than inherited policies.

**Enforcement modes:**

- `enforce` — Transaction is blocked until policy conditions are met.
- `monitor` — Policy is evaluated and logged, but the transaction proceeds. For rollout and tuning.

### 2.3 Approval Requests & Votes

When a transaction triggers an `approval_required` policy, an **ApprovalRequest** is created and attached to the draft.

**Approval flow:**

```
Draft created → Policy engine evaluates → Approval required?
                                            │
                                     No ────┤──── Yes
                                     │             │
                              (existing flow)   ApprovalRequest created
                                                   │
                                              Approvers notified
                                                   │
                                         Approvers vote (approve/reject)
                                                   │
                                       ┌───────────┴───────────┐
                                  All required              Any rejection
                                  approvals met                  │
                                       │                    Draft rejected
                                       │                    UTXOs unlocked
                                  Time delay policy?
                                       │
                                 Yes ──┤── No
                                 │          │
                           Veto window   Draft approved
                           starts        → sign & broadcast
                                 │
                           Any veto? ──Yes──→ Draft vetoed
                                 │
                                 No
                                 │
                           Draft approved
                           → sign & broadcast
```

**Self-approval:** Configurable per policy. Default: the draft creator cannot approve their own transaction. Owner can override this for small teams.

**Quorum styles:**
- `any_n` — Any N approvers from the eligible set.
- `specific` — Specific named users must approve.
- `all` — Every approver on the wallet must approve.

### 2.4 Policy Evaluation Engine

The engine runs at two checkpoints:

1. **Pre-creation** (`POST /transactions/create`) — Evaluates spending limits, velocity, and address controls. If violated in `enforce` mode, the PSBT is not created. Returns which policies would be triggered so the UI can show the user what's needed.
2. **Pre-broadcast** (`POST /transactions/broadcast`) — Re-evaluates all policies. Ensures nothing changed between creation and broadcast (e.g., spending limit was consumed by another transaction in the interim).

**Evaluation is deterministic and logged.** Every evaluation produces a `PolicyEvaluation` record with: which policies were checked, which triggered, what action was taken.

---

## 3. Data Model

### 3.1 New Prisma Models

```prisma
// ─── Vault Policies ───

model VaultPolicy {
  id          String   @id @default(uuid())
  walletId    String?  // null = system-wide policy
  groupId     String?  // non-null = group default template

  name        String
  description String?
  type        String   // spending_limit, approval_required, time_delay, address_control, velocity

  // Type-specific configuration (see Section 4 for schemas)
  config      Json

  priority    Int      @default(0)    // Lower = evaluated first
  enforcement String   @default("enforce") // enforce | monitor
  enabled     Boolean  @default(true)

  // Provenance
  createdBy   String
  updatedBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Origin tracking for inherited policies
  sourceType  String   @default("wallet") // system | group | wallet
  sourceId    String?  // Original policy ID if copied from group/system

  // Relations
  wallet      Wallet?  @relation(fields: [walletId], references: [id], onDelete: Cascade)
  group       Group?   @relation(fields: [groupId], references: [id], onDelete: Cascade)
  creator     User     @relation("PolicyCreator", fields: [createdBy], references: [id])

  approvalRequests ApprovalRequest[]
  policyEvents     PolicyEvent[]
  allowedAddresses PolicyAddress[]

  @@index([walletId, enabled])
  @@index([groupId])
  @@index([sourceType])
}

model ApprovalRequest {
  id                   String   @id @default(uuid())
  draftTransactionId   String
  policyId             String

  status               String   @default("pending") // pending | approved | rejected | expired | vetoed
  requiredApprovals    Int
  quorumType           String   @default("any_n")   // any_n | specific | all
  allowSelfApproval    Boolean  @default(false)

  // Time delay support
  vetoDeadline         DateTime?  // If set, approval enters veto window until this time

  expiresAt            DateTime?  // Auto-expire if not resolved
  resolvedAt           DateTime?

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  // Relations
  draftTransaction DraftTransaction @relation(fields: [draftTransactionId], references: [id], onDelete: Cascade)
  policy           VaultPolicy      @relation(fields: [policyId], references: [id], onDelete: Cascade)
  votes            ApprovalVote[]

  @@index([draftTransactionId])
  @@index([status])
}

model ApprovalVote {
  id                 String   @id @default(uuid())
  approvalRequestId  String
  userId             String

  decision           String   // approve | reject | veto
  reason             String?

  createdAt          DateTime @default(now())

  // Relations
  approvalRequest ApprovalRequest @relation(fields: [approvalRequestId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id])

  @@unique([approvalRequestId, userId]) // One vote per user per request
}

model PolicyEvent {
  id                   String   @id @default(uuid())
  policyId             String?
  walletId             String
  draftTransactionId   String?
  userId               String?

  eventType            String   // evaluated | triggered | approved | rejected | vetoed | overridden | expired | violation
  details              Json     // Type-specific event details

  createdAt            DateTime @default(now())

  // Relations
  policy VaultPolicy? @relation(fields: [policyId], references: [id], onDelete: SetNull)

  @@index([walletId, createdAt])
  @@index([policyId])
  @@index([draftTransactionId])
}

model PolicyAddress {
  id        String   @id @default(uuid())
  policyId  String
  address   String
  label     String?
  listType  String   // allow | deny

  addedBy   String
  createdAt DateTime @default(now())

  // Relations
  policy VaultPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)

  @@unique([policyId, address])
  @@index([policyId, listType])
}

// Tracks cumulative spending for limit enforcement
model PolicyUsageWindow {
  id        String   @id @default(uuid())
  policyId  String
  walletId  String

  windowType  String   // daily | weekly | monthly
  windowStart DateTime
  windowEnd   DateTime

  totalSpent  BigInt   @default(0)  // Satoshis spent in this window
  txCount     Int      @default(0)  // Transactions in this window

  updatedAt   DateTime @updatedAt

  @@unique([policyId, walletId, windowType, windowStart])
  @@index([walletId, windowType, windowEnd])
}
```

### 3.2 DraftTransaction Extensions

Add to existing `DraftTransaction` model:

```prisma
model DraftTransaction {
  // ... existing fields ...

  // Policy governance (new fields)
  approvalStatus    String    @default("not_required") // not_required | pending | approved | rejected | vetoed | expired
  policySnapshot    Json?     // Snapshot of policies evaluated at creation time
  approvedAt        DateTime?
  approvedBy        String?   // User who cast the deciding vote

  // Relations (new)
  approvalRequests  ApprovalRequest[]
}
```

### 3.3 Group Extensions

Add to existing `Group` model:

```prisma
model Group {
  // ... existing fields ...

  // Policy templates (new)
  defaultPolicies VaultPolicy[]  // Policies with groupId set
}
```

### 3.4 Role Extension

Add `'approver'` to the wallet role enum. Update `WalletUser.role` to accept: `'owner' | 'approver' | 'signer' | 'viewer'`.

Add to `MobilePermission` model:

```prisma
model MobilePermission {
  // ... existing fields ...

  canApproveTransaction Boolean @default(false)
  canManagePolicies     Boolean @default(false)
}
```

---

## 4. Policy Type Specifications

### 4.1 Spending Limit (`spending_limit`)

Controls maximum spend amounts.

```typescript
interface SpendingLimitConfig {
  // Per-transaction limit (satoshis). 0 = no limit.
  perTransaction?: bigint;

  // Rolling window limits (satoshis). 0 = no limit.
  daily?: bigint;
  weekly?: bigint;
  monthly?: bigint;

  // Who does this limit apply to?
  scope: 'wallet' | 'per_user';
  // 'wallet' = shared budget across all users
  // 'per_user' = each user has their own budget

  // Exempt roles (e.g., Owner always exempt)
  exemptRoles?: WalletRole[];
}
```

**Evaluation logic:**
1. Check `perTransaction` against the draft amount.
2. Look up `PolicyUsageWindow` for the current daily/weekly/monthly window.
3. Check `currentSpent + draftAmount <= limit` for each window.
4. If `scope: 'per_user'`, use per-user usage windows.

**Budget consumption:** Budget is consumed when a draft is **approved** (not when broadcast). If a draft is deleted or expires, the budget is refunded. This prevents approved-but-unbroadcast drafts from being a loophole.

### 4.2 Approval Required (`approval_required`)

Requires human approval before a transaction can proceed to signing.

```typescript
interface ApprovalRequiredConfig {
  // When does this policy trigger?
  trigger: {
    // Always require approval
    always?: boolean;

    // Amount threshold (satoshis) — require approval above this
    amountAbove?: bigint;

    // Only for transactions to non-allowlisted addresses
    unknownAddressesOnly?: boolean; // Not enforced on its own: create/update require always or amountAbove alongside it.
  };

  // How many approvals needed?
  requiredApprovals: number;

  // Quorum type
  quorumType: 'any_n' | 'specific' | 'all';

  // For 'specific' quorum: which users must approve
  specificApprovers?: string[]; // User IDs

  // Can the transaction creator approve their own tx?
  allowSelfApproval: boolean;

  // Auto-expire pending requests after N hours (0 = never)
  expirationHours: number;
}
```

### 4.3 Time Delay (`time_delay`)

Mandatory cooling period between approval and broadcast eligibility. Any approver can veto during the window.

```typescript
interface TimeDelayConfig {
  // When does this policy trigger?
  trigger: {
    always?: boolean;
    amountAbove?: bigint;
  };

  // Delay duration in hours
  delayHours: number;

  // Who can veto during the delay?
  vetoEligible: 'any_approver' | 'specific';
  specificVetoers?: string[]; // User IDs

  // Notifications during the delay
  notifyOnStart: boolean;  // "Transaction entering 24h cooling period"
  notifyOnVeto: boolean;   // "Transaction vetoed by Alice"
  notifyOnClear: boolean;  // "Cooling period complete, ready to sign"
}
```

**Flow:**
1. Transaction approved by required approvers.
2. Time delay starts. `vetoDeadline = now + delayHours`.
3. All eligible parties notified.
4. During the window: any eligible party can veto.
5. If no veto by deadline: draft status → `approved`, ready to sign.
6. If vetoed: draft status → `vetoed`, UTXOs unlocked, all parties notified.

### 4.4 Address Control (`address_control`)

Restricts which addresses can receive funds.

```typescript
interface AddressControlConfig {
  mode: 'allowlist' | 'denylist';

  // For allowlist: only these addresses can receive
  // For denylist: these addresses are blocked
  // Actual addresses stored in PolicyAddress table for efficient lookup

  // Allow sending to own wallet's addresses? (change, consolidation)
  allowSelfSend: boolean;

  // Who can manage the address list?
  managedBy: 'owner_only' | 'approvers';
}
```

### 4.5 Velocity Control (`velocity`)

Limits transaction frequency to prevent rapid drain.

```typescript
interface VelocityConfig {
  // Max transactions per window
  maxPerHour?: number;
  maxPerDay?: number;
  maxPerWeek?: number;

  scope: 'wallet' | 'per_user';
  exemptRoles?: WalletRole[];
}
```

---

## 5. Transaction Flow Changes

### 5.1 Updated Transaction Lifecycle

```
User clicks "Send"
    │
    ▼
Compose transaction (address, amount, fee, coin selection)
    │
    ▼
Click "Review" → POST /transactions/create
    │
    ▼
┌──────────────────────────────────────┐
│  POLICY EVALUATION (new)             │
│                                      │
│  1. Fetch all active policies        │
│  2. Evaluate each in priority order  │
│  3. Collect results:                 │
│     - policies_satisfied: [...]      │
│     - policies_triggered: [...]      │
│     - required_actions: [...]        │
│  4. Log PolicyEvent for each         │
└──────────────┬───────────────────────┘
               │
        ┌──────┴──────┐
    No triggers    Triggers found
        │                 │
   (existing flow)   Return triggered policies
   Create PSBT       to frontend with PSBT
        │                 │
   Sign & broadcast  Save as draft with
                     approvalStatus: 'pending'
                          │
                     Create ApprovalRequests
                          │
                     Notify approvers
                          │
                     (approval workflow from §2.3)
                          │
                     Once approved:
                     approvalStatus → 'approved'
                          │
                     Signer signs with hardware wallet
                          │
                     POST /transactions/broadcast
                          │
                     ┌────────────────────────┐
                     │  RE-EVALUATE POLICIES   │
                     │  (guard against drift)  │
                     └────────────┬───────────┘
                                  │
                           Still valid? → Broadcast
                           Violated?   → Block, notify, log
```

### 5.2 Policy Engine Injection Points

| Checkpoint | When | What's checked | On failure |
|-----------|------|---------------|------------|
| `pre-create` | Before PSBT generation | address_control, velocity | Reject with explanation |
| `post-create` | After PSBT, before saving draft | spending_limit, approval_required | Force draft into pending state |
| `pre-broadcast` | Before broadcast to network | All policies re-evaluated | Block broadcast, log violation |

### 5.3 Draft Status State Machine

```
                    ┌─────────────┐
                    │ not_required │◄── No policies triggered
                    └──────┬──────┘
                           │
                    (existing flow: sign → broadcast)

┌─────────┐    policies     ┌─────────┐
│ created │───triggered───►│ pending  │
└─────────┘                 └────┬────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
              ┌──────────┐ ┌─────────┐ ┌─────────┐
              │ approved │ │rejected │ │ expired │
              └────┬─────┘ └─────────┘ └─────────┘
                   │
            time delay?
                   │
             Yes──┤──No
              │        │
              ▼        ▼
         ┌────────┐  Ready to sign
         │ cooling │  (existing flow)
         └────┬───┘
              │
        ┌─────┴─────┐
        │           │
        ▼           ▼
   ┌────────┐  ┌────────┐
   │ vetoed │  │approved│ → Ready to sign
   └────────┘  └────────┘
```

---

## 6. API Design

### 6.1 Policy CRUD

```
GET    /api/v1/wallets/:walletId/policies              → List wallet policies (includes inherited)
GET    /api/v1/wallets/:walletId/policies/:policyId     → Get policy details
POST   /api/v1/wallets/:walletId/policies               → Create policy (Owner only)
PATCH  /api/v1/wallets/:walletId/policies/:policyId     → Update policy (Owner only)
DELETE /api/v1/wallets/:walletId/policies/:policyId     → Delete policy (Owner only, wallet-level only)

GET    /api/v1/wallets/:walletId/policies/:policyId/addresses  → List policy addresses
POST   /api/v1/wallets/:walletId/policies/:policyId/addresses  → Add address to list
DELETE /api/v1/wallets/:walletId/policies/:policyId/addresses/:addressId → Remove address
```

### 6.2 System & Group Policies (Admin)

```
GET    /api/v1/admin/policies                           → List system-wide policies
POST   /api/v1/admin/policies                           → Create system-wide policy
PATCH  /api/v1/admin/policies/:policyId                 → Update system policy
DELETE /api/v1/admin/policies/:policyId                 → Delete system policy

GET    /api/v1/admin/groups/:groupId/policies           → List group default policies
POST   /api/v1/admin/groups/:groupId/policies           → Create group default policy
PATCH  /api/v1/admin/groups/:groupId/policies/:policyId → Update group policy
DELETE /api/v1/admin/groups/:groupId/policies/:policyId → Delete group policy
```

### 6.3 Policy Evaluation (Preview)

```
POST   /api/v1/wallets/:walletId/policies/evaluate
  Body: { recipient, amount, feeRate, outputs? }
  Response: {
    allowed: boolean,
    triggered: [
      { policyId, policyName, type, action: 'approval_required' | 'blocked', reason }
    ],
    limits: {
      daily: { used: 50000000, limit: 100000000, remaining: 50000000 },
      perTransaction: { limit: 10000000 }
    }
  }
```

This endpoint lets the frontend show policy status BEFORE the user finalizes the transaction. "This transaction will require 2 approvals from the Treasury team."

### 6.4 Approval Workflow

```
GET    /api/v1/wallets/:walletId/drafts/:draftId/approvals         → List approval requests for draft
POST   /api/v1/wallets/:walletId/drafts/:draftId/approvals/:requestId/vote
  Body: { decision: 'approve' | 'reject' | 'veto', reason?: string }

GET    /api/v1/approvals/pending                                    → List all pending approvals for current user (across wallets)
```

### 6.5 Policy Event Log

```
GET    /api/v1/wallets/:walletId/policies/events
  Query: { from?, to?, type?, policyId?, limit?, offset? }
  → Paginated policy event history
```

---

## 7. Notification Integration

Policy events hook into the existing notification system (Telegram, Push, WebSocket, Webhook).

### New Notification Types

| Event | Recipients | Channels |
|-------|-----------|----------|
| `approval_requested` | All eligible approvers | Telegram, Push, WebSocket |
| `approval_granted` | Draft creator, other approvers | WebSocket |
| `approval_rejected` | Draft creator, all approvers | Telegram, Push, WebSocket |
| `veto_window_started` | All veto-eligible users | Telegram, Push, WebSocket |
| `transaction_vetoed` | Draft creator, all approvers | Telegram, Push, WebSocket |
| `veto_window_cleared` | Draft creator, designated signers | Telegram, Push, WebSocket |
| `approval_expiring` | Pending approvers (at 75% of expiry) | Push, WebSocket |
| `spending_limit_warning` | Wallet owner | WebSocket |
| `spending_limit_reached` | Wallet owner, approvers | Telegram, Push, WebSocket |
| `policy_violation` | Wallet owner, admin | Telegram, Push, WebSocket |

### Telegram Message Format (example)

```
🔒 Approval Required

Wallet: Corporate Treasury
Amount: 2.5 BTC → bc1q...xyz
Requested by: alice
Policy: "Large Transaction Approval" (amounts > 1 BTC)

Required: 2 of 3 approvers
Approved: 0 | Rejected: 0

→ Open Sanctuary to review
```

---

## 8. Frontend Changes

### 8.1 New UI Components

**Policy Management Panel** (wallet settings area):
- List of active policies with enable/disable toggles
- Policy creation wizard with type selection
- Policy editor for each type's config
- Address list manager (for address_control policies)
- Policy event log viewer
- Inherited policy indicators (system/group badges, non-editable)

**Approval Dashboard** (new top-level view):
- Pending approvals across all wallets for current user
- Approval history
- Quick approve/reject with reason
- Badge count in navigation (like unread notifications)

**Draft Card Extensions**:
- Approval status badge: "Pending 1/2 approvals" | "Approved" | "Rejected" | "In cooling period (23h remaining)"
- Approval timeline: who approved when, with reasons
- Veto button (during cooling period)
- Policy violation indicators

**Send Wizard Extensions**:
- Policy preview banner: "This transaction will require approval from 2 approvers"
- Spending limit indicator: "Daily limit: 45,000,000 / 100,000,000 sats used"
- Address control warning: "This address is not on the allowlist"
- "Submit for Approval" button (replaces "Save as Draft" when policies trigger)

### 8.2 Role Management Updates

**Wallet sharing dialog**: Add "Approver" option to role selector.
**User list on wallet**: Show approval capability badge.
**Permission matrix**: Add `canApprove` and `canManagePolicies` toggles.

---

## 9. Mobile Gateway Changes

Add to `whitelist.ts`:

```typescript
// Policy endpoints
{ method: 'GET',    pattern: /^\/api\/v1\/wallets\/[^/]+\/policies$/ },
{ method: 'GET',    pattern: /^\/api\/v1\/wallets\/[^/]+\/policies\/[^/]+$/ },
{ method: 'POST',   pattern: /^\/api\/v1\/wallets\/[^/]+\/policies\/evaluate$/ },

// Approval endpoints
{ method: 'GET',    pattern: /^\/api\/v1\/wallets\/[^/]+\/drafts\/[^/]+\/approvals$/ },
{ method: 'POST',   pattern: /^\/api\/v1\/wallets\/[^/]+\/drafts\/[^/]+\/approvals\/[^/]+\/vote$/ },
{ method: 'GET',    pattern: /^\/api\/v1\/approvals\/pending$/ },
```

Policy management (create/update/delete) is intentionally **excluded** from mobile. Policies should only be managed from the web UI to prevent accidental changes on mobile.

---

## 10. Edge Cases & Security

### 10.1 Policy Changes During Pending Approval

**Rule:** Policies are **snapshotted** at draft creation time (stored in `DraftTransaction.policySnapshot`). A pending draft is evaluated against its snapshot, not current policies. This prevents:
- Retroactive policy tightening from blocking already-approved drafts.
- Policy relaxation from bypassing in-flight approvals.

**Exception:** If a policy is deleted, pending approval requests for that policy are auto-resolved as `approved` (the constraint no longer exists).

### 10.2 Owner Override (Emergency)

An Owner can **force-approve** any pending draft. This:
- Resolves all pending approval requests as `overridden`.
- Creates a `PolicyEvent` with type `overridden` and the Owner's reason.
- Triggers a `policy_violation` notification to all approvers and admins.
- Is permanently recorded in the audit log — it can never be hidden.

This exists for genuine emergencies (time-sensitive transactions) while maintaining accountability.

### 10.3 Approver Removal

If an approver is removed from a wallet while their vote is pending:
- Their existing votes remain valid (historical record).
- They are removed from the eligible approver set.
- If remaining eligible approvers are fewer than required approvals, the request is flagged for Owner attention.

### 10.4 Budget Consumption Timing

Spending limits are consumed when:
- **Approval required:** Budget consumed at approval time (not broadcast). Refunded if draft is deleted/expires.
- **No approval required:** Budget consumed at broadcast time.

This prevents the "approve then never broadcast" loophole from eating budget permanently.

### 10.5 Concurrent Drafts

Multiple drafts can be pending simultaneously. The policy engine must account for the **total committed amount** (all pending + approved drafts) when evaluating spending limits, not just broadcast transactions. This prevents circumventing limits by creating many small drafts.

---

## 11. Phased Delivery

### Phase 1 — Foundation (1 week)

**Goal:** Data model, Approver role, basic policy CRUD, policy evaluation engine.

Deliverables:
1. Prisma migration: `VaultPolicy`, `ApprovalRequest`, `ApprovalVote`, `PolicyEvent`, `PolicyAddress`, `PolicyUsageWindow` tables.
2. `DraftTransaction` extensions: `approvalStatus`, `policySnapshot`, `approvedAt`.
3. Approver role: add `'approver'` to role enum, update `accessControl.ts`, permission matrix, middleware.
4. `VaultPolicyService` — CRUD operations, policy inheritance resolution.
5. `PolicyRepository` — data access layer.
6. Policy CRUD API endpoints.
7. Unit tests for policy CRUD, role resolution.

**Does NOT change the transaction flow yet.** Policies can be created and viewed but don't enforce anything.

### Phase 2 — Enforcement (1 week)

**Goal:** Policy evaluation hooks into the transaction flow. Spending limits and address controls enforced.

Deliverables:
1. `PolicyEvaluationEngine` — evaluates all active policies for a given transaction.
2. Hook into `POST /transactions/create` — pre-creation evaluation.
3. Hook into `POST /transactions/broadcast` — pre-broadcast re-evaluation.
4. `PolicyUsageWindow` tracking — spending accumulation per window.
5. Address control evaluation against `PolicyAddress` table.
6. Velocity control evaluation.
7. Policy evaluation preview endpoint (`POST /policies/evaluate`).
8. `monitor` mode — log but don't block.
9. Frontend: policy preview banner in send wizard, spending limit indicators.
10. Integration tests for policy enforcement.

### Phase 3 — Approval Workflow (1.5 weeks)

**Goal:** Full approval workflow with notifications.

Deliverables:
1. `ApprovalService` — create requests, record votes, resolve requests.
2. Approval API endpoints (vote, list pending).
3. Draft status extensions — `pending` → `approved`/`rejected` flow.
4. Notification integration — new notification types for approval events.
5. Owner override capability.
6. Frontend: approval dashboard, draft card extensions, approve/reject UI.
7. WebSocket events for real-time approval updates.
8. Integration tests for approval workflows.

### Phase 4 — Time Delays & Advanced (1 week)

**Goal:** Cooling periods, veto capability, system/group policies.

Deliverables:
1. Time delay policy type — veto window after approval.
2. Background job for veto deadline expiration (uses existing job queue).
3. System-wide policy management (admin API).
4. Group default policies with inheritance.
5. Policy event log viewer.
6. Mobile gateway whitelist updates.
7. Frontend: veto UI, policy management panel, group policy indicators.
8. End-to-end tests for the complete flow.

### Phase 5 — Polish & Hardening (3-5 days)

**Goal:** Production readiness.

Deliverables:
1. Policy configuration validation (Zod schemas for each config type).
2. Rate limiting on approval endpoints.
3. Circuit breaker on policy evaluation (if policy DB is slow, degrade to allow).
4. Concurrent draft budget accounting (§10.5).
5. Load testing: 50 concurrent policy evaluations.
6. Documentation in PRD and ARCHITECTURE.md.
7. Obsidian knowledge base update.

---

## 12. Migration Strategy

### For Existing Wallets

- All existing wallets start with **zero policies**. Behavior is unchanged.
- Existing roles (Owner, Signer, Viewer) are unaffected.
- Approver role is opt-in — only appears when a wallet owner grants it.
- System admin can create system-wide policies at any time (gradual rollout).

### For Existing Drafts

- Existing drafts get `approvalStatus: 'not_required'` via migration default.
- No retroactive policy application.

### Database Migration

Single migration file. All new tables, no changes to existing table structures except:
- Add `approvalStatus` column to `DraftTransaction` (default: `'not_required'`).
- Add `policySnapshot` JSON column to `DraftTransaction` (nullable).
- Add `approvedAt` and `approvedBy` columns to `DraftTransaction` (nullable).
- Add `'approver'` to role validation in application code (no DB enum change needed — roles are strings).

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Policy evaluation latency (p95) | < 50ms |
| Approval notification delivery | < 5s from vote to notification |
| Zero false blocks | No legitimate transaction blocked by policy bug |
| Zero bypasses | No policy-violating transaction broadcast |
| Adoption | > 50% of multisig wallets have at least one policy within 30 days of release |

---

## 14. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `server/src/services/vaultPolicy/vaultPolicyService.ts` | Policy CRUD, inheritance resolution |
| `server/src/services/vaultPolicy/policyEvaluationEngine.ts` | Evaluate policies against transactions |
| `server/src/services/vaultPolicy/approvalService.ts` | Approval workflow logic |
| `server/src/services/vaultPolicy/types.ts` | TypeScript interfaces for all policy configs |
| `server/src/repositories/policyRepository.ts` | Policy data access |
| `server/src/repositories/approvalRepository.ts` | Approval data access |
| `server/src/api/wallets/policies.ts` | Policy CRUD endpoints |
| `server/src/api/wallets/approvals.ts` | Approval workflow endpoints |
| `server/src/api/admin/policies.ts` | System-wide policy admin endpoints |
| `server/src/jobs/definitions/policyJobs.ts` | Expiration, veto deadline jobs |
| `components/PolicyManager/` | Policy management UI components |
| `components/ApprovalDashboard/` | Approval dashboard UI |
| `src/api/policies.ts` | Frontend API client for policies |
| `src/api/approvals.ts` | Frontend API client for approvals |
| `src/hooks/queries/usePolicies.ts` | React Query hooks for policies |
| `src/hooks/queries/useApprovals.ts` | React Query hooks for approvals |

### Modified Files

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | New models + DraftTransaction extensions |
| `server/src/services/wallet/accessControl.ts` | Add Approver role, canApprove capability |
| `server/src/services/wallet/types.ts` | Add 'approver' to WalletRole union |
| `server/src/middleware/walletAccess.ts` | Approver role middleware |
| `server/src/services/mobilePermissions/types.ts` | Add canApprove, canManagePolicies |
| `server/src/api/transactions/drafting.ts` | Policy evaluation hook (pre-create) |
| `server/src/api/transactions/broadcasting.ts` | Policy re-evaluation hook (pre-broadcast) |
| `server/src/services/draftService.ts` | Approval status management |
| `server/src/services/notifications/notificationService.ts` | New notification types |
| `server/src/api/wallets/sharing.ts` | Approver role in sharing |
| `gateway/src/routes/proxy/whitelist.ts` | Policy/approval endpoint whitelist |
| `components/WalletDetail/tabs/DraftsTab.tsx` | Approval status display |
| `components/DraftList/DraftRow.tsx` | Approval badges, vote buttons |
| `components/WalletDetail/tabs/SettingsTab.tsx` | Policy management link |
| `contexts/send/` | Policy preview integration |
| `hooks/send/useSendTransactionActions.ts` | Policy evaluation before create |

---

## 15. Relationship to Existing Plans

| Plan | Relationship |
|------|-------------|
| **Technical Debt (Phase 2)** | Pagination on policy events and approval lists follows the same pattern. |
| **Reliability Hardening** | Policy evaluation engine gets circuit breaker (Phase 5). Job queue handles veto deadlines using existing infrastructure. |
| **v0.8.11 Scope** | Independent. Vault policies would target v0.9.0 as a minor version bump reflecting the feature significance. |

---

## 16. Open Questions

1. **Should policies be versioned?** If a policy is modified, should existing pending approvals continue under the old version or be re-evaluated? (Current proposal: snapshot at creation.)
2. **Cross-wallet spending limits?** Some organizations may want "total spend across all wallets < X/day." Deferred to v2 but architecture should not preclude it.
3. **Policy templates library?** Ship with pre-built templates ("Conservative Treasury", "Family Vault", "Startup Operations") that users can one-click apply? (Recommended for Phase 5.)
4. **Webhook integration for approvals?** External systems (Slack bots, internal tools) may want to cast approval votes programmatically. (Recommended for post-launch.)
5. **Hardware wallet requirement for Owner override?** Should force-override require the Owner to prove key possession (sign a challenge), or is password + 2FA sufficient? (Recommended: password + 2FA for v1, hardware challenge for v2.)

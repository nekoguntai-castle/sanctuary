# Bitcoin Inheritance Protocol ("Dead Man's Switch")

## Problem

Self-custody's darkest unsolved question: "What happens to my Bitcoin when I die?" This is the #1 reason people cite for NOT self-custodying. No self-hosted coordinator does it well.

## Value Proposition

- Transforms Sanctuary from "nice-to-have power tool" into "essential family infrastructure"
- No watch-only coordinator offers this — first mover advantage
- Drives multi-user adoption organically (you MUST onboard your heirs)
- Makes Sanctuary stickier than any other feature — you don't migrate away from your inheritance plan
- The feature that turns a technical user's spouse from "why do you need this?" to "thank god we have this"

## Existing Building Blocks

| Building Block                              | Status           |
| ------------------------------------------- | ---------------- |
| Vault policies with time delays             | Done (Phase 1-3) |
| Approval workflows with configurable roles  | Done             |
| Multi-user wallet sharing with RBAC         | Done             |
| Audit logging                               | Done             |
| Telegram/push notifications                 | Done             |
| 2FA + email verification                    | Done             |
| PSBT creation without keys                  | Done             |
| Hardware wallet signing flows               | Done             |

## How It Works

### 1. Heartbeat Check-in

Owner configures a check-in interval (e.g., every 90 days). Sanctuary sends periodic "are you alive?" pings via Telegram/push/email. Owner taps to confirm.

### 2. Escalation Cascade

If no check-in after the grace period, Sanctuary begins a configurable escalation:

- More aggressive notifications
- Secondary contact alerts
- Eventually triggers the inheritance plan

### 3. Inheritance Plan

Pre-configured actions that execute after the dead man's switch fires:

- Designated heirs get elevated wallet access (Viewer -> Signer roles)
- Pre-drafted PSBTs become available for signing
- Recovery instructions (stored encrypted) are revealed
- Optional: timelock-enforced on-chain (using `OP_CHECKLOCKTIMEVERIFY`) so the protocol is trustless, not just server-side

### 4. Safety Rails

- Multiple abort mechanisms
- Trusted contacts who can pause the countdown
- Configurable delays at each stage
- Full audit trail
- False positives must be nearly impossible

### 5. Test Mode

Families can do a "fire drill" — simulate the entire inheritance flow without actually moving funds. Peace-of-mind feature.

## Rough Scope

3-4 weeks given existing infrastructure. Hardest part is UX design for an emotionally sensitive flow and making the safety rails bulletproof.

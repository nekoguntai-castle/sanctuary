# Wallet-safety audit review — release runbook

> **SUSPENDED as of v0.8.65.** Neither release-candidate validation nor the
> publication command enforces this gate today. Everything below describes how to
> produce the evidence, and stays accurate for the day it is reinstated — nothing
> here has been deleted.
>
> **Why.** The gate requires a human attestation, preferably from two identities.
> This repository has one maintainer, so every release resolved to a self-review
> with a mandatory hour between generating the audit and approving it. Against a
> maintainer deployment that holds **zero wallets**, that ceremony attested to an
> empty dataset: the v0.8.64 evidence says so in its own words — "it is not
> evidence about production wallet state". The cost was real and recurring; the
> protection, at that wallet count, was not.
>
> **What still protects wallet-safety code.** Everything automated, all still
> blocking: the per-file mutation gates on the funds-controlling modules
> (`psbtAccountBinding`, `feePolicy`, `taproot*`, `receiveEvidence`) with their
> canary map, the wallet-safety classifier drift check, `verify-vectors` including
> the Jade/Ledger/Trezor emulator proofs, and the critical-path inventory in
> `config/wallet-safety-critical-paths.json` — which is still maintained, because
> reinstating the gate depends on it being accurate.
>
> **What is no longer enforced.** A human confirming they looked at the diff of
> wallet-safety-critical paths before the release ships, and the audit of live
> wallet rows that confirmation was attached to.
>
> **Reinstate when there is a second maintainer** — that is the condition that
> makes the two-identity path possible and the ceremony meaningful. Reinstatement
> is wiring, not a rewrite: `verify-wallet-safety-audit-review.mjs` and its unit
> tests (`tests/release/wallet-safety-audit-review.test.mjs`) are untouched. Restore
> the `wallet-safety-audit-review` job in `.github/workflows/release-candidate.yml`
> and the `verify_wallet_safety_audit_review` call in
> `scripts/release/publish-release.sh`; both are one revert away in git history.
>
> Until then, production wallets are audited post-upgrade rather than pre-release —
> see `reports/incident-wallet-sync-v0.8.63-2026-08-18.md`.

## When it applies

The gate fires when a release contains changes to any path in
`config/wallet-safety-critical-paths.json` — `server/src/services/wallet/**`,
`walletRemediation/**`, `bitcoin/**`, `prisma/**`, `api/transactions/**` and others. It is
evaluated against the diff between the previous release and the RC head, so a release that
touches none of them needs nothing.

Evidence is loaded from the `WALLET_SAFETY_AUDIT_REVIEW_JSON` repository variable and must
name the exact RC head commit, be at most 7 days old, and be approved.

## 1. Produce the audit

Run against a **real database** — the audit reads live wallet rows, so an empty test
database proves nothing.

```bash
npm run audit:wallet-safety -- --output /tmp/wallet-safety-audit.json
sha256sum /tmp/wallet-safety-audit.json     # the reportSha256 below
```

Exit code 0 with zero findings is `clean`. Exit code 2 means findings exist and have been
reviewed; that is accepted, but only with `result: "findings_reviewed"` and a matching
`findingCount`. Any other exit code is a failure to fix, not to record.

Expect exit code 2 on any deployment holding wallets recovered by the remediation flow:
those report `descriptor.provenance_recovered` permanently and by design, so they classify
`manual_investigation` rather than `proven_safe`. That finding is not a defect — it records
that a wallet's descriptor origin was never known. See
`docs/plans/legacy-wallet-descriptor-policy-recovery.md`.

## 2. Review it

**Two people is the preferred path.** The operator runs the audit; a different person reads
the report and approves it. Record their identities in `operatorId` and `reviewerId`.

```json
{
  "schemaVersion": "sanctuary.wallet-safety-audit-review.v1",
  "sourceCommit": "<RC head commit, full 40-char sha>",
  "audit": {
    "schemaVersion": "sanctuary.wallet-safety-audit.v2",
    "generatedAt": "2026-08-18T10:00:00.000Z",
    "result": "clean",
    "exitCode": 0,
    "findingCount": 0,
    "reportSha256": "<sha256sum of the report>",
    "operatorId": "<who ran the audit>"
  },
  "review": {
    "decision": "approved",
    "reviewedAt": "2026-08-18T11:30:00.000Z",
    "reviewerId": "<who reviewed it>",
    "reference": "<issue, PR, or review record>"
  }
}
```

## 3. Single-maintainer releases

A two-person review is unsatisfiable on a repository with one maintainer. Rather than
leaving a rule that every release quietly works around — which is worse than no rule — the
gate accepts a self-review that is **explicitly attested and separated in time**:

```json
  "review": {
    "decision": "approved",
    "reviewedAt": "2026-08-18T11:30:00.000Z",
    "reviewerId": "<same id as operatorId>",
    "reference": "<issue or release record>",
    "selfReviewAttestation": "Single-maintainer repository; no second reviewer exists. Report read in a separate session before approval."
  }
```

Both conditions are enforced, not advisory:

- `selfReviewAttestation` must be a non-empty string. Omitting it restores the original
  "reviewer must be independent" failure.
- `reviewedAt` must be **at least one hour after** `generatedAt`. Approving in the same
  timestamp as generation is rejected.

What the two-person rule actually prevents is rubber-stamping — approving your own output
in the same breath as producing it. The interval and the attestation keep that protection
in the only form one person can satisfy. **It is not a lower bar for the report itself:**
read it, and if a finding is genuinely unexplained, do not approve.

Do **not** substitute an automated agent as the reviewer. It shares the operator's framing
and fails in the same places, so it satisfies the letter of the check while removing the
thing being checked.

## 4. Load and verify

```bash
# Set the repository variable WALLET_SAFETY_AUDIT_REVIEW_JSON to the JSON above, then:
node scripts/release/verify-wallet-safety-audit-review.mjs \
  --head "$(git rev-parse HEAD)" --base "<previous release tag>" \
  --evidence /tmp/review-evidence.json --max-age-days 7
```

Prints `not required` when the release touches no critical path, `accepted` when the
evidence satisfies the gate, and a specific reason on failure.

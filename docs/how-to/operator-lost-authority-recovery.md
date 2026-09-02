# Operator lost-authority recovery

This command is a one-incident recovery path for the four targets in
`config/operator-recovery-incident.json`. It is not a general manual Docker
cleanup command and does not reconstruct lost CI authority.

## Preconditions

- Use only code merged to `main` after landed-main CI is green.
- Keep the key root, trust file, runtime directory, incident evidence, and four
  stack evidence directories outside the checkout, owner-only (`0700`).
- Never put provider credentials in request files or command output. The CLI
  reads `SANCTUARY_FORGE_TOKEN`, `FORGEJO_TOKEN`, or the Git credential helper.
- Confirm the active `sanctuary` project and the unlabeled
  `ci-local-3469272-1788333412-1-install-upgrade` project are healthy and must
  remain unchanged.
- Images and BuildKit caches are observed and retained; they are never targets.

## Ceremony

Every command accepts one canonical JSON request path and prints only bounded
digests and status. Use the checked incident and recovery contracts from the
same merged checkout.

1. Run `provision` once with `keyRoot`, `trustPath`, `trustId`, and a short
   `validUntil`. It creates distinct authorization and evidence keys.
2. Run `begin` with `incidentEvidenceDirectory`, `keyRoot`, `trustPath`, and
   `incidentContractPath`. This signs the immutable identities and labels of the
   two excluded Compose projects before any mutation.
3. For one target at a time, run `prepare`. Review its exact project,
   `scopeDigest`, `approvalDigest`, and `actionCount`. Preparation is read-only,
   verifies the checked target tuple/counts, performs bounded Forgejo
   correlation, and persists a single-use signed approval.
4. Run `execute` with the unchanged request only after reviewing preparation.
   Do not prepare or execute a later target until this one has a successful
   signed receipt.
5. If execution stops after its journal is created, rerun the same request with
   `recover`. Recovery reclaims only a stale lock bound to that journal,
   reconciles an open intent, and never replays a confirmed mutation. If no
   journal exists, recovery still requires current unexpired authority.
6. After all four receipts succeed, run `closeout` with the incident evidence
   directory and exactly four unique stack evidence directories. Closeout
   reobserves the excluded projects, verifies every signed scope, approval, and
   receipt by role, requires zero target residue, records retained images and
   BuildKit state, and signs the exact four-pair result.

The executable is:

```text
node scripts/ownership/operator-recovery-cli.mjs <provision|begin|prepare|execute|recover|closeout> <request.json>
```

## Stop conditions

Stop without further mutation on any tuple/count discrepancy, partial or
malformed ownership, same-project extra resource, daemon or provider drift,
changed exclusion sentinel, expired unused approval, ambiguous action result,
non-success receipt, or missing signature. Preserve the external evidence and
journal. Never substitute `docker compose down`, broad prune commands, raw
engine deletion, another run/task identifier, or a newly manufactured receipt.

Successful closeout claims only that the 60 enumerated container/network/volume
targets (15 per stack) reached their exact postconditions and the explicit
neighbor sentinels stayed unchanged. It makes no claim about unobserved
historical resources or retained image/cache ownership.

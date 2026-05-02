# Sanctuary Security Assessment — 2026-04-29

Read-only static review of `/home/nekoguntai/sanctuary` performed by Claude
Opus 4.7. Scope = the 22 areas in the brief. No code, configs, or website
copy were modified.

A note on `npm audit`: the harness blocked `npm` invocations in this
session, so vulnerable-dependency counts are marked **Unknown** and need to
be re-run by the parent.

---

## TL;DR for website copy

The current "experimental, in active development, hasn't had an
independent review yet" framing is **roughly accurate but slightly
generous in tone and underclaiming on substance**. The watch-only
guarantee is real and architecturally enforced — there is genuinely no
code path on the server that ever holds a Bitcoin private key, seed, or
mnemonic. Most foundational web-app controls (bcrypt password hashing,
short-lived JWTs with revocation, double-submit CSRF bound to the access
cookie, AES-256-GCM at rest, parameterized SQL via Prisma, per-route RBAC
through `requireWalletAccess`, fail-closed Redis-backed rate limiting,
HMAC-signed gateway-to-server calls, an isolated AI proxy with no DB
access) are present and look competently implemented.

The honest weaknesses that should not be hidden behind "experimental":
(1) the bundled admin user ships with the **well-known default password
"sanctuary"** and the soft `usingDefaultPassword` flag does **not block
login** — single-user installs left untouched are trivially compromised,
(2) **no MAX_FEE_RATE ceiling** on the standard transaction-create
endpoint (the agent path enforces it), so a buggy or malicious client
could request a PSBT with an absurd fee; the hardware wallet remains the
last line of defence here, and (3) privacy-purpose output shuffling and
decoy amount generation use **`Math.random`**, not `crypto.randomBytes`
— the privacy story is weaker than the marketing implies. There is also
**no HMAC/signature on backup files** and **no per-user TOTP replay
guard** beyond a 30-second tolerance window. None of these are fatal,
but the "hasn't had an independent review" line is doing a lot of work
to cover them and should be paired with a short, specific list of
known-weakness disclosures.

---

## Strengths (claim these on the site)

- **Server is genuinely watch-only.** A grep across
  `server/src/` and `shared/` for `privateKey`, `toWIF`, `fromWIF`,
  `fromSeed`, `HDPrivateKey`, `Mnemonic`, `signInput`, `signTransaction`,
  `signAll` returned **zero matches in production code** (only "signed
  PSBT shape", `signedDeviceIds`, and `signature` appear). PSBT
  construction (`server/src/services/bitcoin/transactions/createTransaction.ts:36`)
  takes only xpub-derived material; signing is delegated entirely to
  hardware wallets which return signed PSBTs that the server merges
  (`server/src/services/draftUpdate.ts:46-80`).
- **Strong key derivation for at-rest encryption.**
  `server/src/utils/encryption.ts:54-89` uses AES-256-GCM with random
  16-byte IV per encrypt and the auth tag is verified on decrypt; the
  key is derived once at startup with async `scrypt`
  (`server/src/utils/encryption.ts:121-142`).
- **JWT discipline:** `jti` for revocation, distinct `aud` claims for
  access vs refresh vs 2FA, 1h access / 7d refresh, refresh tokens
  stored only as SHA-256 hashes (`server/src/utils/jwt.ts:90-205`,
  `server/prisma/schema.prisma:812-829`), revocation table
  `RevokedToken` (`schema.prisma:833`).
- **CSRF design is sound** — double-submit binding the CSRF token to the
  access cookie via HMAC of the JWT secret, with strict same-site,
  HttpOnly access/refresh cookies, and a clear bypass rule for the
  Authorization-header path (`server/src/middleware/csrf.ts:36-141`).
- **Authorization is consistently centralised.**
  `requireWalletAccess('view'|'edit'|'approve'|'owner')` is applied on
  every wallet-scoped route I sampled; the wallet router itself mounts
  `authenticate` at the top
  (`server/src/api/wallets.ts:37`,
  `server/src/api/transactions/*.ts`,
  `server/src/api/wallets/{crud,policies,approvals,export,...}.ts`).
- **Gateway uses a strict route allow-list**
  (`gateway/src/routes/proxy/whitelist.ts:72`+) instead of pass-through;
  admin, backup, node-config endpoints are explicitly not exposed.
- **Gateway-to-server calls are HMAC-signed with timestamp** (5-minute
  freshness window, timing-safe compare,
  `server/src/middleware/gatewayAuth.ts`).
- **AI proxy is properly isolated** — its own container, no DB access,
  required `AI_CONFIG_SECRET` shared secret (auto-generated if absent
  but logged loudly), timing-safe header comparison
  (`ai-proxy/src/auth.ts`, `ai-proxy/src/index.ts:1-100`).
- **Rate limiting fails closed** on Redis errors
  (`server/src/middleware/rateLimit.ts:120-128`), is distributed via
  Redis, and has per-policy windows (login 5 attempts/15min,
  `server/src/config/envSections.ts:21`).
- **Agent API keys** are hashed with HMAC-SHA256 keyed by
  `ENCRYPTION_KEY`, not just SHA-256, so a DB compromise doesn't let an
  attacker enumerate keys offline (`server/src/utils/apiKeyHash.ts:24`).
- **Helmet CSP is real**, not the default permissive shape — `script-src
  'self'`, `object-src 'none'`, `upgrade-insecure-requests` in prod
  (`server/src/index.ts:99-114`).
- **Sensitive log redaction list is comprehensive** — covers `xpub`,
  `xprv`, `seed`, `mnemonic`, `passphrase`, `pin`, `otp`, `totp`,
  `backupcode`, `recoverycode` plus the usual suspects
  (`server/src/utils/redact.ts:21-65`). I confirmed the one place that
  logs an xpub only logs the 4-char prefix
  (`server/src/services/bitcoin/transactions/psbtConstruction.ts:210`).
- **Zod schema validation across the boundary** — every route I sampled
  passes through `validate({ body: ... })` with a Zod schema
  (`server/src/api/auth/login.ts:204`,
  `server/src/api/wallets/crud.ts:64`).
- **Fail-loud secret hygiene** — `JWT_SECRET` missing throws a
  fatal error with multi-line console banner; `ENCRYPTION_SALT` /
  `GATEWAY_SECRET` are required in production
  (`server/src/config/index.ts:263-291`,
  `server/src/config/index.ts:194-211`).
- **CI has gitleaks, CodeQL, ESLint, lizard (complexity), jscpd
  (duplication), actionlint** wired as blocking checks
  (`.github/workflows/quality.yml`, `.github/workflows/codeql.yml`).
  Dependabot is configured for npm and github-actions
  (`.github/dependabot.yml`).
- **HSTS is set in nginx**
  (`docker/nginx/default-ssl.conf.template:68,150,167`,
  `max-age=31536000; includeSubDomains`).
- **All raw SQL is parameterised** — every `$queryRaw` /
  `$executeRaw` use is a tagged template literal; **no
  `queryRawUnsafe` / `executeRawUnsafe` calls** in production code
  (greps in `server/src/`).
- **Server runs as non-root in Docker**, uses dumb-init for proper
  signal handling, has a HEALTHCHECK (`server/Dockerfile`).

---

## Known weaknesses (acknowledge or fix-before-claim)

- **HIGH — Default admin password is not enforced to change.**
  `server/prisma/seed.ts:580-609` ships admin/`sanctuary` and stores a
  marker; `isUsingInitialPassword()` only sets a `usingDefaultPassword`
  flag in the response (`server/src/api/auth/login.ts:312-329`,
  `server/src/api/auth/password.ts:25-48`). Nothing prevents a logged-in
  admin from doing real work with the default password. **Public copy
  must say:** "the default admin password must be changed on first
  login — currently the system warns but does not enforce".
- **HIGH — Standard PSBT-create endpoint has no MAX_FEE_RATE.**
  `server/src/api/transactions/drafting.ts:204` enforces only the
  minimum fee rate. The agent service correctly enforces both
  (`server/src/services/agentApiService.ts:318` uses `MAX_FEE_RATE =
  1000`). A buggy client could request a PSBT with sat/vB in the
  thousands; the hardware wallet display is the only remaining
  defence. Should be fixed before claiming "server prevents fee
  surprises". Not a private-key compromise, but a UX/foot-gun issue.
- **MED — Output shuffling and decoy-amount generation use
  `Math.random()`.** `server/src/services/bitcoin/transactions/outputBuilder.ts:73,221`
  Fisher-Yates shuffle for privacy uses `Math.random`; same for decoy
  output amounts in
  `server/src/services/bitcoin/psbtBuilder/decoyAmounts.ts:34,48,68`.
  Predictable PRNG → an observer who can correlate timing/state can
  in principle distinguish change from recipient and partially undo
  the privacy. Should use `crypto.randomBytes` / `crypto.randomInt`.
- **MED — No TOTP replay protection.**
  `server/src/services/twoFactorService.ts:50-66` accepts any valid
  code in the ±30s window without recording the last-used code per
  user. Within a 30-second window a captured TOTP can be re-used.
  Real impact is small (window is short, attacker also needs the
  password) but it's a documented best-practice gap.
- **MED — Backup files have no integrity/authenticity tag.**
  `server/src/services/backupService/creation.ts:22-77` produces a
  plain JSON dump; `validation.ts` only sanity-checks structure and
  referential integrity. There is no HMAC, no signature, no
  encryption envelope. An attacker who can substitute a backup before
  restore can poison admin records, group memberships, and 2FA secrets
  (which decrypt with the same `ENCRYPTION_KEY`). Backups also contain
  `RefreshToken` rows (hashed) and `AuditLog` history — moderately
  sensitive on disk.
- **MED — Bcrypt cost is 10**, not the modern recommendation of 12+
  (`server/src/utils/password.ts:9`). Defensible for self-hosted boxes
  with limited CPU, but lower than what most security reviewers will
  expect.
- **MED — No account lockout.** Login is rate-limited at 5/15min per
  IP+username (`server/src/config/envSections.ts:21`) but there is no
  per-account lockout, so an attacker rotating IPs continues unimpeded.
  Fine for self-hosted, mention it.
- **LOW — `usingDefaultPassword` is computed by re-hashing and
  comparing against a stored bcrypt hash.** `auth/password.ts:47`
  compares `initialPasswordSetting.value === user.password` — works
  because both are bcrypt of the same default with stored salt; doesn't
  leak material but is brittle if anyone ever rehashes.
- **LOW — Backup restore poisoning.** Combined with the missing
  integrity check above, the restore path
  (`server/src/services/backupService/restore.ts`) trusts the JSON's
  declared shape; admin-only endpoint mitigates blast radius.
- **LOW — Audit log is not tamper-evident.** Plain Postgres rows in
  `audit_logs` (`server/prisma/schema.prisma:761-783`) — a DB-level
  attacker (who already owns the box) can edit/delete entries without
  detection. No append-only enforcement, no Merkle chain, no remote
  shipping. Acceptable for a self-hosted product but worth saying so.
- **LOW — `crossOriginEmbedderPolicy: false`** to keep WebUSB working
  (`server/src/index.ts:112`). Documented and intentional but reduces
  Spectre mitigations slightly. Note in security page.
- **LOW — JWT secret minimum length is a warning, not an error.**
  `getJwtSecret()` at `server/src/config/index.ts:284` only `console.warn`s
  on secrets shorter than 32 chars and continues. Install scripts
  generate 48-char secrets so default deployments are fine.
- **LOW — Encryption key derivation salt has a backward-compat
  default.** `server/src/utils/encryption.ts:14-31` falls back to a
  hard-coded `sanctuary-node-config` if `ENCRYPTION_SALT` is unset
  (with a multi-line warn). Production startup validation does require
  it (`server/src/config/index.ts:194-201`), so non-prod is the only
  exposure.

---

## Not implemented / out of scope

- **No password reset / "forgot password" flow.** Intentional for a
  self-hosted single-trust-domain product — a stolen password without
  email-loop recovery is the secure default. Worth saying explicitly so
  users don't expect it.
- **No automated `npm audit` gate in CI.** Dependabot opens PRs but
  there is no failing job for newly-disclosed vulnerable transitive
  deps (`.github/workflows/*.yml`).
- **No application-layer encryption of backup payloads.** Operators are
  expected to encrypt at rest themselves (LUKS / cloud KMS).
- **No remote audit-log shipping or WORM target.**
- **No push-notification token rotation policy** (PushDevice rows are
  long-lived, `schema.prisma:789-803`).
- **No HTTP→HTTPS redirect on the backend itself** — relies on nginx
  in front (the documented deployment topology).

---

## Unknowns (need follow-up)

- **`npm audit` high/critical counts (root, server, gateway,
  ai-proxy).** The harness blocked `npm audit` in this session. The
  declared deps are modern (Prisma 7, Express 5, bcryptjs 3, jsonwebtoken
  9, helmet 8, zod 4) so my a-priori guess is "low", but the parent
  agent should run it.
- **Mobile app/iOS code-side handling of refresh tokens** — out of
  scope (lives in a separate repo per the AGENTS.md context).
- **Whether the Telegram and email notification paths leak xpubs/PSBTs
  in their templates** — sampled but not exhaustively read.
- **Whether the hardware-wallet device catalog (`HardwareDeviceModel`)
  validates fingerprints against attestation** — beyond static-read
  scope.
- **Whether the WebSocket layer enforces the same wallet-access checks
  as REST.** I read the middleware list (auth + walletAccess) but did
  not exercise the `websocket/` handlers end-to-end.
- **Tor / SOCKS path security properties** (`docker-compose.tor.yml`).
- **TLS cipher suite of the bundled nginx config.** I confirmed HSTS
  but did not verify the cipher list / TLSv1.2-min.

---

## Detailed findings by area

### 1. Authentication
**Verdict: Adequate.** bcrypt (cost 10) at
`server/src/utils/password.ts:9-17`; password strength enforced on
register and on change via `validatePasswordStrength` and `PasswordSchema`
(8+ chars, upper/lower/digit) at
`server/src/api/schemas/auth.ts:22-37`. Failed logins are audited
(`server/src/api/auth/login.ts:213-249`). No password reset flow (by
design). No account lockout — only IP+username rate limiting.

### 2. 2FA
**Verdict: Adequate.** TOTP via `otplib`, secret encrypted with
AES-256-GCM before storage (`server/src/services/twoFactorService.ts:32-44`),
backward-compat with legacy plaintext secrets via `decryptIfEncrypted`.
Backup codes hashed with bcrypt(10) (`twoFactorService.ts:93-101`),
backup-code use is marked persistently
(`server/src/api/auth/twoFactor/verify.ts:62-65`). Backup-code count is
10. **No replay protection on TOTP codes** within the ±30s tolerance
window. `otplib` `createGuardrails({ MIN_SECRET_BYTES: 10 })` lowered
for legacy compat.

### 3. Authorization / RBAC
**Verdict: Solid.** Resource access goes through a single factory
`createResourceAccessMiddleware`
(`server/src/middleware/walletAccess.ts:29-44`,
`server/src/middleware/resourceAccess.ts`); roles are
owner/approver/signer/viewer with explicit predicates. The wallet
router applies `authenticate` at the top
(`server/src/api/wallets.ts:37`) and every sub-route I sampled adds
`requireWalletAccess(...)`. Cache TTL is short (30s) and invalidations
are fired on share/unshare. No IDOR vectors found in the routes
sampled — every wallet-scoped handler reads the URL `:walletId` which
the middleware has already authorised.

### 4. Watch-only assertion
**Verdict: Solid.** Greps for `privateKey`, `toWIF`, `fromWIF`,
`fromSeed`, `HDPrivateKey`, `Mnemonic`, `signInput`, `signTransaction`,
`signAll`, `signAllInputs` across `server/src/` and `shared/` returned
**zero production matches**. Variables named `signed*` refer to
already-signed PSBT artifacts received from hardware wallets. The
PSBT-builder module
(`server/src/services/bitcoin/psbtBuilder/index.ts`) only handles
xpub-derived BIP32 derivations and witness scripts. The architectural
guarantee holds.

### 5. PSBT construction & signing flow
**Verdict: Adequate.** `createTransaction` validates recipient
addresses against the wallet's network
(`server/src/services/bitcoin/transactions/createTransaction.ts:69-79`).
Vault policies are evaluated before PSBT creation
(`server/src/api/transactions/drafting.ts:138-147`). `MIN_FEE_RATE` is
checked. **`MAX_FEE_RATE` is NOT enforced on the standard create
endpoint** — only on the agent path
(`server/src/services/agentApiService.ts:318-321`). Hardware-wallet
display remains the user's last defence. PSBT merge logic
(`server/src/services/draftUpdate.ts:40-80`) preserves prior
signatures.

### 6. Cryptography at rest
**Verdict: Solid.** AES-256-GCM, 16-byte random IV per encrypt, auth
tag verified on decrypt, key derived once via async `scrypt(key, salt,
32)` and cached (`server/src/utils/encryption.ts:54-142`). `ENCRYPTION_KEY`
must be ≥32 chars or startup throws; `ENCRYPTION_SALT` falls back to a
hard-coded default in non-prod with a loud warning. Encrypted fields
include 2FA secrets and node-RPC passwords; agent API keys are
HMAC-hashed with the encryption key. No key rotation story documented.

### 7. Secrets handling
**Verdict: Adequate.** `JWT_SECRET` missing → fatal startup error,
short → warn (`server/src/config/index.ts:263-291`).
`scripts/setup.sh:286-624` auto-generates 48-char secrets via `openssl
rand`. `.gitleaks.toml` exists and is wired into `quality.yml` as a
blocking gate. Sensitive-field redaction list is comprehensive
(`server/src/utils/redact.ts:21-65`). I sampled login/2fa/wallet
handlers and did not find any secret echoed in API responses or error
messages. PSBT logging only logs xpub/scripts in 4-char prefix form.

### 8. Input validation
**Verdict: Solid.** Every state-changing route I sampled goes through
Zod via the `validate` middleware. Bitcoin addresses are validated for
the wallet's network before any PSBT touches them
(`server/src/api/transactions/drafting.ts:131-135`). Amounts use
BigInt at the policy and DB layers (`schema.prisma` uses `BigInt` for
output values). Labels do not escape into HTML in the server (frontend
is responsible) — there is even an explicit safety test
(`server/tests/unit/services/bitcoin/industry/labelSafety.test.ts`).

### 9. SQL injection / ORM
**Verdict: Solid.** Prisma client only, repository layer enforced by
`scripts/check-prisma-imports.ts`. Every `$queryRaw` / `$executeRaw`
call is a **tagged template literal** (parameterised); zero
`queryRawUnsafe` / `executeRawUnsafe` calls in production source.

### 10. XSS
**Verdict: Solid (server side).** No `dangerouslySetInnerHTML` outside
of test files (grep across `components/`, `src/`, `App.tsx`, all `*.tsx`
in the repo). React's default escaping plus the strict CSP in
`server/src/index.ts:99-114` (`script-src 'self'`) is the defence in
depth. Frontend was sampled, not exhaustively read — full XSS
attestation requires reviewing every label/note rendering site, which
exceeds time budget; flagged as a partial-coverage area.

### 11. CSRF
**Verdict: Solid.** Double-submit pattern via `csrf-csrf`, secret is
HMAC of `JWT_SECRET` so no extra env var, token is bound to the access
cookie's value via `getSessionIdentifier`, header `X-CSRF-Token`,
sameSite=strict, csrf cookie is non-HttpOnly so frontend can read it,
auth cookies are HttpOnly+Secure(prod)+sameSite=strict
(`server/src/middleware/csrf.ts:36-228`). Bypass for the
Authorization-header path is correctly conditional on
`extractTokenFromHeader` returning a token, matching the auth
middleware's source-selection precedence.

### 12. Gateway & mobile API
**Verdict: Solid.** Strict route allow-list
(`gateway/src/routes/proxy/whitelist.ts`), helmet, CORS allow-list,
coarse 10x rate-limit ceiling on top of route policies
(`gateway/src/index.ts:60-95`). Backend-direction calls are HMAC-SHA256
signed with timestamp and 5-minute freshness
(`server/src/middleware/gatewayAuth.ts`). JWT verification mirrors the
backend's audience and shape checks. `GATEWAY_SECRET` is required in
production.

### 13. AI-proxy
**Verdict: Solid.** Separate container with no DB/keystore access,
required `AI_CONFIG_SECRET`/`AI_SERVICE_SECRET` shared secret with
timing-safe comparison (`ai-proxy/src/auth.ts`), all backend → AI
calls are auth'd, AI proxy fetches sanitised data from
`/internal/ai/*` only. The threat model (`ai-proxy/src/index.ts:1-18`)
is clearly stated and matches what the code does. Prompt-injection
surface exists by definition of LLM use, but the proxy returns
suggestions that the user must confirm — server never auto-acts on AI
output.

### 14. Backup/restore
**Verdict: Weak.** No HMAC, signature, or encryption envelope on the
backup file (`server/src/services/backupService/creation.ts`,
`serialization.ts`). Validation checks structure and FK references
only (`validation.ts`). Backup contains `users`, `walletUser`,
`refreshTokens` (hashed), `auditLogs`, `twoFactorSecret` (encrypted
with `ENCRYPTION_KEY`). Restore is admin-only behind authenticated
endpoint, but a stolen-and-tampered backup can poison the system.

### 15. Audit log integrity
**Verdict: Adequate.** Comprehensive event taxonomy
(`server/src/services/auditService.ts:38-155`), every auth event
(login success/fail, 2FA pass/fail, password change, admin user
create) is logged with IP and user-agent. **Storage is plain Postgres**
— a DB attacker can edit/delete; no append-only enforcement, no
external shipping. Acceptable for self-hosted; should be disclosed.

### 16. Logging hygiene
**Verdict: Solid.** `redact.ts` covers xpub/xprv/seed/mnemonic/totp/
backup-code etc. I found one xpub-related debug log
(`server/src/services/bitcoin/transactions/psbtConstruction.ts:210`)
and confirmed it only emits 4-char prefixes. No PSBT bodies, JWTs, or
session tokens land in logs in the handlers I sampled. IP/UA are
logged in audit (intentional for security forensics) — note in
privacy copy.

### 17. Dependency posture
**Verdict: Unknown (could not run `npm audit` — harness blocked).**
Declared versions in `server/package.json` are modern: Prisma 7.6,
Express 5.2, jsonwebtoken 9.0.2, bcryptjs 3.0.3, helmet 8.1, zod 4.3,
csrf-csrf 4.0, otplib 13.4, bitcoinjs-lib 7.0.1. Lockfiles
(`package-lock.json`) present at root, server, gateway, ai-proxy.
Dependabot configured for npm and github-actions
(`.github/dependabot.yml`). **No `npm audit` job in CI** — recommended
addition.

### 18. Docker security
**Verdict: Adequate.** Non-root user (uid 1001) in server image,
dumb-init for signal handling, multi-stage build with `npm prune
--production`, HEALTHCHECK present (`server/Dockerfile`). Frontend
nginx image also runs as non-root user (uid 1001). Read-only rootfs is
NOT set. Capability drops are NOT explicit (Docker default).
Postgres/redis use official Alpine images; redis password is required
via env. `mem_swappiness: 0`, memory limits set
(`docker-compose.yml:62-72`). Secrets via env, not files.

### 19. TLS / transport
**Verdict: Adequate.** `docker-compose.ssl.yml` exists; nginx
templates set HSTS `max-age=31536000; includeSubDomains` always
(`docker/nginx/default-ssl.conf.template:68,150,167`). Auth cookies
are `secure: true` only in production (`server/src/middleware/csrf.ts`).
`upgradeInsecureRequests` is set in CSP for production. **TLS cipher
list / minimum version not verified** — flagged as Unknown. Default
deployment ships with self-signed certs generated by `start.sh`.

### 20. Rate limiting / DoS
**Verdict: Solid.** Redis-backed with in-memory fallback
(`server/src/services/rateLimiting/`), per-policy windows
(`policies.ts`), keys by ip / user / ip+user. **Fails closed on Redis
errors** (returns 503, blocks the request,
`server/src/middleware/rateLimit.ts:120-128`). Coarse safety valves on
`/api` and `/internal` (`server/src/index.ts:125-147`). Login is 5
per IP+user per 15min (`config/envSections.ts:21`). `requestTimeout`
middleware caps slow requests.

### 21. Test coverage of security paths
**Verdict: Solid.** Dedicated tests under
`server/tests/unit/security/` and `server/tests/unit/middleware/` for
auth, csrf, walletAccess, agentAuth, gatewayAuth, validate,
rateLimit, deviceAccess, resourceAccess. Per CLAUDE.md the backend
holds a 99% coverage threshold and the frontend 100%, enforced in CI
(`.github/workflows/test.yml`). The existing `securityAudit.test.ts`
documents historical findings and would catch regressions on those
specific items.

### 22. CI security gates
**Verdict: Adequate.** Blocking jobs in `quality.yml`: lint, gitleaks
(layered over `.gitleaks.toml` allowlist, full-history scan), lizard
complexity, jscpd duplication, actionlint. Separate `codeql.yml` for
JS/TS and Actions. Dependabot for npm + github-actions, weekly. **No
`npm audit` job** — biggest gap. No SAST beyond CodeQL. No SBOM
publication.

---

## Recommended website copy changes

- **`security.html`** — Replace blanket "experimental, hasn't had an
  independent review yet" with a structured three-part block:
  1. **What we guarantee architecturally:** server is watch-only (no
     code path holds private keys, seeds, or mnemonics), all signing
     happens on hardware wallets, AES-256-GCM at rest with scrypt-derived
     key, JWT revocation + 2FA TOTP + per-route wallet RBAC, strict CSRF,
     HMAC-signed gateway-to-backend calls, isolated AI proxy with no DB
     access.
  2. **What we ship sensible defaults for:** strong password policy,
     fail-closed Redis-backed rate limiting, Helmet CSP, HSTS, Dependabot,
     gitleaks + CodeQL in CI, ≥99% backend test coverage including auth
     and authorisation paths.
  3. **What we explicitly do not yet do, that an audit would flag:**
     no enforced password change for the bundled `admin/sanctuary`
     account (warned but not blocked), no `MAX_FEE_RATE` ceiling on the
     standard transaction-create endpoint, privacy-purpose output
     shuffling/decoy generation uses `Math.random` rather than
     `crypto.randomBytes`, no HMAC on backup files, no per-user TOTP
     replay guard within the 30-second tolerance window, no account
     lockout (only IP+username rate-limit), no remote audit-log
     shipping, no `npm audit` gate in CI.
- **`faq.html` "Has Sanctuary been audited?"** — Change to: "No
  independent third-party security audit has been performed yet. We
  have published an honest internal assessment dated 2026-04-29 listing
  our specific known weaknesses; please read that before relying on
  Sanctuary for non-trivial amounts. The watch-only guarantee is
  architecturally enforced and easy to verify by grepping the source for
  `privateKey`, `seed`, `mnemonic`, etc."
- **`disclaimer.html`** — Add a sentence: "On a fresh install you must
  change the default `admin / sanctuary` credentials immediately. The
  product currently warns about this on login but does not block usage
  — treat the warning as a hard requirement."
- **`index.html` callout** — Soften "privacy-preserving" or qualify it
  with "decoy outputs and output shuffling are implemented but use a
  non-cryptographic PRNG; treat them as defence in depth, not as a
  primary anonymity guarantee" — *or* fix the `Math.random` calls before
  the next release and keep the current language.

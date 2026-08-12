# ADR 0003: Jade Plus authentication and PIN-oracle boundary

- **Status:** Accepted
- **Date:** 2026-08-11
- **Accepted on:** 2026-08-11
- **Owner:** Sanctuary maintainers
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `config/jade-protocol-harness.json`, `scripts/ci/jade-vendor-protocol-harness.py`, `src/services/hardwareWallet/adapters/jade.ts`

## Context

Jade and Jade Plus use a blind PIN protocol before funds-controlling RPCs. The
device can answer `auth_user` with an `http_request` continuation. Blockstream's
reference client performs that HTTP request and then calls the device method in
`on-reply` until the device returns a final result. The pinned firmware release
uses `POST` JSON requests to `https://j8d.io/get_pin` or
`https://j8d.io/set_pin`, with `pin` as the continuation method. The reference
client also proves two other contracts needed by PR10B: PSBTs are binary values,
and large signed PSBT replies are collected through `get_extended_data`.

Sanctuary's existing adapter does none of this. It sends ad-hoc CBOR directly
from the browser, discards unexpected frames and trailing bytes, has no
authentication loop, exposes no stable fingerprint, sends a base64 PSBT string,
and trusts the returned PSBT. All Jade funds-controlling capability rows are
therefore blocked. This ADR does not enable them.

The device supplies URLs as data. Treating those URLs as authority would make a
connected device an SSRF and privacy boundary. Browser-direct requests would
also couple authentication to upstream CORS behavior and expose the user's IP
address directly to the oracle. A generic server proxy would move the SSRF risk
to the backend without removing it.

## Decision drivers

1. A device-controlled value must never select an arbitrary server-side URL.
2. PIN-oracle payloads, responses, and device identifiers must not enter logs.
3. Oracle outage, malformed continuations, and network mismatch must fail closed.
4. The selected Bitcoin network and connected device identity must remain bound
   across authentication, import, display, and signing.
5. The implementation must match a pinned vendor reference rather than a local
   interpretation of the protocol.
6. Custom PIN servers, Tor/onion routing, QR/offline use, and multisig must not be
   represented as supported before each has its own design and evidence.

## Options considered

### Browser-direct oracle requests

The browser could execute the device-provided HTTPS URL directly.

- Rejected because device input would influence the destination, CORS becomes a
  production dependency, redirects are difficult to constrain consistently,
  and the upstream sees the user's public IP.

### Generic authenticated Sanctuary proxy

The browser could send the entire device `http_request` object to a backend that
fetches its URLs.

- Rejected because a malicious or custom-configured device would gain an
  authenticated server-side HTTP primitive. URL validation and DNS rebinding
  defenses would become funds-critical code for no product benefit.

### Embed or port the complete vendor Python client into production

The browser or server could execute `jadepy` as the production integration.

- Rejected because the browser transport is TypeScript/WebSerial, a Python
  subprocess would add a privileged runtime boundary, and the default vendor
  HTTP helper intentionally acts as a simple proxy. The reference client remains
  the conformance oracle, not a production request dependency.

### Fixed same-origin relay

The browser validates the continuation shape, reduces it to an operation and
opaque JSON body, and sends it to one same-origin application endpoint. The
server constructs the only permitted upstream URL from constants.

- Accepted because neither the browser nor device selects a host, scheme, port,
  or path; CORS is removed from the hardware flow; application auth and CSRF
  remain available; and the boundary is small enough to test exhaustively.

### Offline, QR, custom PIN server, or onion fallback

- Deferred and blocked. The chosen relay intentionally supports only the
  official clearnet oracle. Devices configured with custom endpoints fail with
  an explicit unsupported-configuration error. Oracle outage does not fall back
  to a device URL, direct browser fetch, onion, or unauthenticated route.

## Decision

Adopt a **same-origin, fixed-destination PIN relay** for PR10B.

The browser-facing route is `/api/v1/hardware/jade/pin`. It accepts only an
authenticated, CSRF-protected request containing:

- `operation`: exactly `get_pin` or `set_pin`;
- `data`: the opaque JSON body produced by the Jade protocol.

The route constructs exactly one upstream URL:

- `get_pin` becomes `https://j8d.io/get_pin`;
- `set_pin` becomes `https://j8d.io/set_pin`.

It uses `POST`, accepts JSON, follows zero redirects, performs zero automatic
retries, enforces the byte and timeout limits in
`config/jade-protocol-harness.json`, and rejects non-2xx, non-JSON, oversized,
or truncated responses. Redirects are failures even when they point back to the
same host. The request and response bodies are never logged. Diagnostics may
contain only an operation name, bounded timing, status category, and a generated
request correlation ID that is unrelated to the Jade RPC ID.

The browser-side protocol accepts an auth continuation only when all of these
are true:

- the outer result contains exactly one supported `http_request` continuation;
- `method` is `POST`, `accept` is JSON, and `on-reply` is `pin`;
- the URL set contains the exact official clearnet URL for the selected
  operation and contains no other clearnet destination;
- the body is JSON and satisfies the configured byte limit.

The browser sends only `operation` and `data` to Sanctuary. It never forwards a
device URL. The relay returns only the bounded JSON body, which the client sends
back to Jade as the `pin` method parameters using a new correlated RPC ID.

Authentication is part of one selected-device session. The requested Bitcoin
network is passed to `auth_user` and must match every later path/policy request.
After authentication, PR10B derives the BIP32 master fingerprint transiently
from the root xpub's public key, then discards the root xpub. Import, display, and
signing require that fingerprint plus the exact canonical account path and xpub.
No empty or account-parent fingerprint substitute is allowed.

The production client will implement the vendor byte protocol, not the current
single-buffer approximation:

- binary CBOR with complete-message parsing and preservation of trailing bytes;
- exact response-ID correlation and rejection of stale, duplicate, or
  unsolicited messages;
- bounded frame, aggregate buffer, chunk count, and RPC timeouts;
- binary PSBT input;
- `seqnum`/`seqlen` `get_extended_data` collection with exact `origid` binding;
- structural and cryptographic validation of the returned PSBT, signatures,
  signer account, change, and user-authorized transaction intent.

The pinned vendor harness downloads Blockstream Jade release 1.0.40 by immutable
commit, verifies the tarball and all executed source files, and runs the official
`JadeAPI` auth continuation, binary PSBT chunk reconstruction, and error
propagation logic inside an exact Python image. It is a Tier 1 protocol oracle,
not Tier 2 emulator or Tier 3 physical-device evidence.

## Threat model and controls

| Threat                                                | Control                                                                                                                              | Failure behavior                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Malicious device supplies an internal or attacker URL | Device URLs are validation input only; server constructs a fixed origin and operation path                                           | Reject before any HTTP request                          |
| Custom PIN server or onion-only device configuration  | Not supported by this decision                                                                                                       | Explicit unsupported error; capability remains blocked  |
| Redirect or DNS/host confusion                        | HTTPS origin and path are constants; redirects disabled                                                                              | Reject response                                         |
| Unauthenticated cross-site relay use                  | Existing application authentication plus CSRF are mandatory                                                                          | 401/403 before upstream request                         |
| PIN-oracle payload leakage                            | No body, URL query, device ID, fingerprint, xpub, or PSBT logging                                                                    | Sanitized category-only diagnostic                      |
| Oracle observes the user                              | Server relay hides the browser IP from the oracle, but Sanctuary still observes user/timing and the oracle observes Sanctuary/timing | Documented privacy tradeoff; no identifiers added       |
| Compromised or malformed oracle response              | TLS plus bounded JSON syntax/size; Jade cryptographically validates the blind PIN exchange                                           | Reject transport errors; Jade error remains fail closed |
| Oracle outage or ambiguous POST result                | No automatic retry and no alternate destination                                                                                      | User may retry the whole auth flow explicitly           |
| Replay or stale device response                       | Exact RPC ID and selected-session binding                                                                                            | Reject and disconnect the session                       |
| CBOR fragmentation/coalescing attack                  | Incremental decoder preserves trailing bytes; frame and buffer limits                                                                | Abort and disconnect                                    |
| Extended-data loop or chunk confusion                 | Exact `origid`, monotonic sequence, stable `seqlen`, chunk and byte limits                                                           | Reject before PSBT use                                  |
| Network/path substitution                             | Auth network, canonical policy, fingerprint, account path, and xpub are one immutable operation context                              | Reject before display/signing                           |
| Altered returned PSBT                                 | Independent PSBT/signature/intent/change validation from PR6/7                                                                       | Reject before finalization or broadcast                 |
| Offline/QR path bypasses auth                         | No offline/QR Jade capability in PR10B                                                                                               | Capability remains blocked                              |

## PR10B implementation acceptance tests

These IDs are machine-locked in `config/jade-protocol-harness.json`. PR10B may
enable no capability until the relevant tests and evidence exist.

| ID                    | Required acceptance test                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JADE-AUTH-001`       | Complete vendor-shaped multi-message `auth_user` on mainnet and every supported test-family network before any funds-controlling RPC.                                                                                             |
| `JADE-AUTH-002`       | Reject method, accept type, `on-reply`, URL, operation, body size, redirect, auth, CSRF, content type, response size, timeout, retry, and logging-policy violations. Prove the server never receives or fetches an arbitrary URL. |
| `JADE-AUTH-003`       | Reject auth/session reuse across network changes, reconnects, multiple devices, or stale RPC IDs.                                                                                                                                 |
| `JADE-IDENTITY-001`   | Derive the master fingerprint from a transient root xpub, discard that xpub, and bind exact fingerprint/path/account xpub for import, display, and signing. Reject empty or substituted identity.                                 |
| `JADE-FRAMING-001`    | Parse fragmented and coalesced CBOR messages while preserving trailing bytes; reject malformed, oversized, duplicate, stale, and unsolicited frames within bounded time.                                                          |
| `JADE-PSBT-001`       | Send PSBT bytes, collect bounded monotonic `get_extended_data` chunks with exact `origid`, and reproduce the vendor result byte for byte.                                                                                         |
| `JADE-PSBT-002`       | Validate every returned signature and the complete PSBT against account bindings, UTXOs, change, and user-authorized intent before finalization/broadcast.                                                                        |
| `JADE-FAILCLOSED-001` | Prove oracle outage, denial, locked/disconnected device, malformed continuation, bad JSON, chunk truncation/reorder, and limit exhaustion cannot fall back or return partial success.                                             |
| `JADE-IMPORT-001`     | Provide a first-class Jade Plus import/account-add flow for canonical supported single-signature policies only, with exact device/network labeling.                                                                               |
| `JADE-EVIDENCE-001`   | Pin Jade QEMU/reference inputs for Tier 2 and require current model/firmware/browser/OS/display/signature Tier 3 evidence before enabling each physical row.                                                                      |
| `JADE-MULTISIG-001`   | Keep every Jade multisig import/display/signing row blocked until registration, ordering, address display, signing, and physical proof are separately approved.                                                                   |

## Consequences

### Positive

- A connected device cannot turn Sanctuary into a generic HTTP proxy.
- The vendor reference is executable and version/hash pinned.
- CORS and browser-to-oracle connectivity are removed from the production auth
  path.
- The design has explicit negative tests and size/time limits before code is
  allowed to control funds.

### Negative

- Jade USB authentication requires the Sanctuary backend and network access to
  the official oracle.
- Custom PIN servers, Tor/onion routing, and offline/QR Jade use remain blocked.
- The server learns that an authenticated user is performing a Jade PIN
  operation and its timing, though it must not retain the opaque body.

### Neutral

- The reference harness is not a claim of QEMU or physical-device support.
- Jade and Jade Plus continue to share protocol code only where the pinned
  vendor contract is identical; their physical capability rows remain separate.
- Multisig remains blocked.

## Rollback

PR10A adds no production route and enables no capability. It can be reverted by
removing this ADR, its manifest/harness, and the mandatory workflow step. If
PR10B is later reverted, all Jade funds-controlling rows return to the existing
blocked state; no fallback to the current adapter is permitted.

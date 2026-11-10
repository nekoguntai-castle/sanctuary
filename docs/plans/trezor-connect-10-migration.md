# Trezor Connect 10 migration

Status: reviewed 2026-11-09 (recursive plan review, §11). Phase A
implemented on `refactor/trezor-connect-seam` (see "Phase A as built");
Phase B not started, gated on the §5 spike.
Self-contained: written to be executed from a fresh context. Closes #537 as a
side effect. Ships in the **next release** together with the OTel fix already
on main (#1496) — decided by the user 2026-11-09.

## 1. Decision and why

Move Trezor support from `@trezor/connect-web@9.7.3` to Connect 10, behind a
narrow adapter seam so the SDK is not woven into the app.

Connect 9 is end of life, and our integration is exposed to it today:

- trezor/trezor-suite#34334 deprecates every `@trezor/connect*` version below
  10 on npm: "Trezor Connect 9 is no longer supported and gets no fixes."
  Pilot text: web integrations "depend on connect.trezor.io/9, which will be
  shut down soon" (no date announced; 9.7.3 not yet marked deprecated as of
  2026-11-09).
- trezor/trezor-suite#33222 (draft) adds a remote Suite config switch,
  `connect.v9.refuse`, answering Connect 9 apps with `Method_NotAllowed`.
- hoseki-inc/bitcoin-control-center#326 reports Connect 9 no longer works with
  current Suite or the Trezor Safe 7.
- Sanctuary runs `connect-web` with `coreMode: 'auto'`
  (`src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts:175-185`), so
  its core is already Trezor-hosted at `connect.trezor.io/9`. Signing breaks
  on Trezor's schedule when that host or Suite stops serving v9.

Target: Connect 10.0.1 (published 2026-09-25). Docs:
https://connect.trezor.io/10.0.0/guides/migrating-to-connect-10 and the
CHANGELOG.md inside the npm tarball (`npm pack @trezor/connect@10.0.1`).

Transport decision (user, 2026-11-09): the **Suite-hosted flow**. Operators
run the browser, the Trezor and Trezor Suite on a local computer, and reach
Sanctuary on a remote machine. With Connect 10, the page served by Sanctuary
talks to Suite desktop over loopback on that local computer, or falls back to
the Suite Web popup. Device traffic never touches the Sanctuary host. Running
the full `@trezor/connect` core in the page over WebUSB, without Suite, was
rejected: an earlier, otherwise complete WebUSB integration (around 2025)
without Trezor Suite did not work.

Non-goals: replacing Trezor or Connect with direct WebUSB/THP or an in-page
WebUSB core; the
`vite-plugin-node-polyfills` elliptic path and the dev-only minimatch
advisory (§3); any server change (the server never sees SDK types).

## 2. What Connect 10 changes (verified against the 10.0.1 tarballs)

- **Flow.** Calls route to Trezor Suite: Suite desktop over loopback when
  running, else a Suite Web popup on `https://suite.trezor.io`. Requires
  Suite >= 26.7.2. Device selection and passphrase entry happen in Suite.
  Suite shows a permission prompt with `manifest.appName` + origin
  (+ optional `appIcon`).
- **Headers.** The Suite Web channel needs CSP that allows framing
  `https://suite.trezor.io` and a COOP other than `same-origin`. Our nginx
  (`docker/nginx/default.conf.template`, `default-ssl.conf.template`) sets
  neither CSP nor COOP, so nothing blocks it. `X-Frame-Options SAMEORIGIN`
  only governs others framing us.
- **Public API tier.** `@trezor/connect-web` exports
  `TrezorConnectPublicAPI` = core + all callables minus
  `TrezorConnectManagement` (applyFlags, applySettings, authenticateDevice,
  backupDevice, bleUnpair, changeLanguage, changePin, changeWipeCode,
  evolu*, getFirmwareHash, getNonce, getSettings, loadDevice, pingDevice,
  recoveryDevice, resetDevice, setBrightness, setBusy, telemetryGet,
  thp*Credentials, wipeDevice). **All 6 SDK methods `src/` calls remain**:
  `init` (trezorAdapter.ts:175), `getFeatures` (:245), `getDeviceState`
  (:254), `getPublicKey` (:274, :356), `getAddress` (:415),
  `signTransaction` (signPsbt.ts:98). Plus the helper `asDeviceUniquePath`
  (sessionIdentity.ts:1, :72, :80), still exported (identity function).
  `unlockPath` is only mentioned in a comment (pathUtils.ts:66). `dispose`
  is called only by the emulator test (trezorEmulator.integration.test.ts:328).
  `on`/`off`/`uiResponse`/`updateConnectSettings` throw `TypeError` on the
  thin client (unused by us).
- **Error shape (breaking, funds path).** v10 failure is
  `{ success: false, error: { message, code }, payload?: undefined }`
  (`@trezor/connect-common/lib/types/params.d.ts`, `constants/errors.d.ts`);
  v9 was `{ success: false, payload: { error, code } }`. Five v9-shape reads
  in `src/`: trezorAdapter.ts:248 (`result.payload as {error?, code?}` for
  getFeatures), :259 (getDeviceState), :365 (getPublicKey), :426
  (getAddress), signPsbtValidation.ts:35-37 (`getSerializedTrezorTx`). On v10
  each throws a TypeError instead of a clean error. Error codes worth mapping
  to user-cancel: `Method_Interrupted` ("Popup closed"), `Method_Cancel`.
- **Coin parameter (breaking).** `coin` must be a `CoinSymbol` shortcut;
  labels are rejected at runtime. Bitcoin set: `btc`, `test`, `regtest`. Our
  sites: trezorAdapter.ts:104-105 (`getCoinForPath`), :276, :359, :419;
  signPsbtNetwork.ts:13, :77; signPsbt.ts:67; and the emulator test's own
  call (trezorEmulator.integration.test.ts:137, `coin: "Testnet"`).
- **Device identity.** `CommonParams.device` is still
  `{ path?, state?, instance?, useEmptyPassphrase? }`; responses still carry
  an **optional** `device?: DeviceIdentity`. Whether Suite populates it in
  the Suite-hosted flow is unverified (§5).
- **signTransaction payload shapes** (inputs/outputs with `address_n`,
  `script_type`, `multisig`; `refTxs`; result `serializedTx`/`signatures`)
  and `getPublicKey` result fields we read (`descriptor`, `depth`,
  `childNum`, `parentFingerprint`, `xpub`) were **not** diffed v9→v10 yet.
  Phase B step 2 does that diff against the v10 `.d.ts` files.
- **ESM-only** packages. Vite and vitest handle ESM.
- **Transports** (in-process core only, i.e. the emulator proof): must be
  instances; string ids like `"BridgeTransport"` are rejected. The legacy
  trezord-go Bridge is unsupported (changelog: "Legacy `trezord-go` Bridge
  (port `21325`) is no longer supported"). `BridgeTransport`
  (`@trezor/transport-common`) defaults to port 21328. `@trezor/transport`
  (Node) exports `UdpTransport` and `NodeUsbTransport`.

## 3. Dependency facts (verified by scratch resolves)

- `@trezor/connect-web@10.0.1` alone, prod-only audit: **0 findings**. Its
  direct deps are only `@trezor/utils`, `@trezor/connect-common`,
  `@trezor/websocket-client`. elliptic / tiny-secp256k1 / crypto-browserify
  are gone (clears all 12 low findings of #537 on the Trezor path).
- The full `@trezor/connect@10.0.1` core (needed only by the emulator proof)
  pulls `@trezor/network-stellar@10.0.1` → `@stellar/stellar-sdk@17.0.0` →
  `axios@1.18.0`: **7 high** advisories (fixed in axios >= 1.20.0). The audit
  gate (`scripts/ci/npm-audit-gate.mjs:19`) runs `npm audit --json` with no
  `--omit=dev`, so devDependencies count. With a root `overrides` entry
  `"axios": "1.21.1"` the full tree audits at 0 (main already resolves
  `node_modules/axios@1.20.0`; `server` declares `^1.20.0`, satisfied). Use
  the override, not a waiver.
- `src/` never imports `@trezor/connect`, only `@trezor/connect-web`; the
  emulator proof imports `@trezor/connect` (test :7). In v10
  `@trezor/connect` moves to `devDependencies`.
- Remaining unrelated advisories after migration: elliptic via
  `vite-plugin-node-polyfills` (dev, low) and the dev-only minimatch
  GHSA-g3hv-75wg-m249 (moderate, fixed only in minimatch 11). Out of scope.

## 4. Architecture: keep the blast radius small

Current state: the SDK is imported by exactly 3 files, all in
`src/services/hardwareWallet/adapters/trezor/` (`trezorAdapter.ts:9`,
`signPsbt.ts:8`, `sessionIdentity.ts:1`). The app talks to Trezor only via
the generic `DeviceAdapter` interface (`src/services/hardwareWallet/types.ts:98`),
constructed as `new TrezorAdapter()` in `src/services/hardwareWallet/runtime.ts:17-26`
(behind a `/* v8 ignore next */`, Trezor capability rows are fail-closed).
`TrezorConnectSignedArtifact` (types.ts:43) is our own shape. Other `trezor`
mentions in `src/` are device-type strings and UI copy.

Weak points: SDK calls and SDK result shapes are spread across 3 files; SDK
*request* shapes are built by payload builders (`signPsbtPayloads.ts`,
`multisig.ts`, `refTxs.ts`, `signPsbtValidation.ts`, with types in
`adapters/trezor/types.ts:26-32`, and `any[]` for refTxs at refTxs.ts:195
and signPsbtValidation.ts:8, `result: any` at :35); 6 test files
`vi.mock('@trezor/connect-web')`; the emulator proof swaps the SDK via a
vitest module alias and passes v9-only init settings.

### 4.1 Target design

1. **One SDK boundary module**, `adapters/trezor/connectClient.ts`: the
   only file in `src/` that imports `@trezor/*`. It exports:
   - `interface TrezorConnectClient` with exactly the 6 operations
     (`init`, `getFeatures`, `getDeviceState`, `getPublicKey`,
     `getAddress`, `signTransaction`), typed with **our** DTOs declared in
     `adapters/trezor/types.ts` (excluded from coverage by
     `src/services/**/types.ts`):
     - `TrezorDeviceIdentity { path: string; state?: string; instance: number }`
     - `TrezorCallResult<T> = { ok: true; value: T; device?: TrezorDeviceIdentity }
       | { ok: false; error: { message: string; code?: string } }`
     - `type TrezorNetwork = 'mainnet' | 'testnet' | 'regtest'`. The client
       maps it to `btc`/`test`/`regtest`; no SDK coin string leaves the
       module.
     - Narrow param/result types for each call, only the fields we read.
   - `TREZOR_CONNECT_VERSION` moves here from trezorAdapter.ts:32, and
     trezorAdapter.ts re-exports it so the proof and fixture references
     keep working.
   - An exported pure `normalizeConnectResult(raw)` that converts the SDK
     result into `TrezorCallResult`. It handles both the v9 and v10 failure
     shapes (Phase A lands on v9). Phase B deletes the v9 branch.
   - `createConnectWebClient(settings)`, the production implementation.
2. **SDK-shaped payload DTOs.** `signTransaction`'s params use our DTOs
   (`TrezorSignInput`, `TrezorSignOutput`, `TrezorRefTx`, `TrezorMultisig`,
   with `script_type` string unions such as `SPENDWITNESS`). Its result is
   `{ serializedTx: string; signatures: string[] }`. The payload builders
   stay outside the boundary but are typed with these DTOs, which replaces
   the `any`s. Structurally they are the SDK wire format. The client is the
   only place that asserts DTO ↔ SDK type compatibility, through a
   type-level check in `connectClient.ts`:
   - Derive the SDK types without deep imports, e.g.
     `type SdkSignParams = Parameters<typeof TrezorConnect.signTransaction>[0]`,
     then `SdkSignParams['inputs'][number]`.
   - Assert that our DTOs are assignable to them. This costs no runtime and
     no coverage, and `typecheck:app` is the gate.
   - In v9, `coin` is typed `string`, so only the runtime contract test can
     catch coin drift.
3. **Injection.** `TrezorAdapter` takes `client?: TrezorConnectClient`
   instead of `initSettings` (trezorAdapter.ts:112, :130). The default is
   `createConnectWebClient(defaultSettings)`, created lazily in
   `initialize()`, so `runtime.ts` (`new TrezorAdapter()`) is unchanged.
   `signPsbt.ts` receives the client. `sessionIdentity.connectDevice()` and
   `connectSelectedDevice()` return `TrezorDeviceIdentity`, and the client
   brands `path` with `asDeviceUniquePath`.
4. **Guardrail.** The ESLint ban on `@trezor/**` imports is described in
   §6 Phase A step 3. No dependency-cruiser rule: it has no hardwareWallet
   rules today and would add arch-lint surface for no gain.
5. **Tests mock the port, not the SDK.** Unit tests construct
   `new TrezorAdapter(fakeClient)`. One contract test file,
   `tests/services/hardwareWallet.trezorConnectClient.test.ts`, mocks
   `@trezor/connect-web` and pins the mapping: v9 and v10 failure shapes,
   success with and without `device`, every coin mapping, init failure and
   path branding.
6. **The emulator proof uses the same seam** via a test-only factory in
   `tests/integration/trezorEmulator/`. The factory wraps the in-process
   `@trezor/connect` core and runs its raw results through the same
   exported `normalizeConnectResult`, not a copy, so the proof keeps
   exercising production normalization.

Result: a future Connect 11 (or direct WebUSB/THP) changes
`connectClient.ts`, its DTO compatibility check and its contract test only.

### 4.2 Repo gates the refactor must respect

- **Signer inventory**: `scripts/generate-signer-inventory.mjs:154-156` and
  `config/hardware-wallet-implementation-inventory.json:408-425` pin these
  (file, name, kind) tuples:
  - `signPsbt.ts:signPsbtWithTrezor`
  - `signPsbtValidation.ts:finalizeAllInputs`
  - `trezorAdapter.ts:signPSBT`

  Do not rename or move these functions. Keep exactly one
  `finalizeAllInputs`. Name no new top-level identifier `finalize*` (it
  would be swept into the funds-execution inventory). Check with
  `node scripts/generate-signer-inventory.mjs --check` (:864) and
  `tests/ci/signerInventoryGeneration.test.ts`. The test
  `hardwareWalletImplementationInventory.test.ts` only checks the
  device-type to vendor mapping.
- **Wallet-safety classification**: `config/wallet-safety-critical-paths.json:68`
  (`src/services/hardwareWallet/**`) and :76 (`tests/services/hardwareWallet*.test.ts`)
  make both PRs wallet-safety-critical, so the verify-vectors and emulator
  lanes run. `tests/fixtures/wallet-safety-required-files.json:84` lists
  `trezorAdapter.ts`; keep that file.
- **Emulator source inventory**: `config/hardware-emulator-source-inventory.json:43-66`
  covers `adapters/trezor/**` and `tests/integration/trezorEmulator/**` by
  pattern, so `connectClient.ts` and the test factory are covered. Any new
  helper outside those globs needs a `files` entry. Validate with
  `node scripts/ci/hardware-emulator-source-inventory.mjs validate`.
- **Lizard**: the warning count must not exceed
  `LIZARD_WARNING_BASELINE: '86'` (`.github/workflows/quality.yml:54`). Keep
  the normalizer and coin map small and table-driven. Check with
  `npm run quality:lizard`.
- **jscpd** (`config/tooling/jscpd.json`, 5%, minLines 10, tests ignored):
  keep the six client wrappers table-driven rather than copy-pasted.
- **Coverage**: frontend coverage is 100% on `src/**/*.{ts,tsx}`
  (`config/tooling/vitest.config.ts:85-91`). `connectClient.ts` is not
  excluded, so the contract test must cover every branch. The emulator test
  is excluded from the normal run (vitest.config.ts:94-97), so coverage
  will not catch drift there.
- **arch:check**: `scripts/architecture/generate-graphs.mjs:35-41` collapses
  `src` to 3 path segments, and externals are not drawn. Expect no diff in
  `docs/architecture/generated`; commit one only if it appears. Run it in
  the primary checkout only.
- **Lifecycle callsites**: run `node scripts/ownership/check-lifecycle-callsites.mjs`.
  It skips untracked files, so `git add` new files first.

## 5. Funds-safety invariant: session binding

`sessionIdentity.ts` binds every funds-controlling call to the device path,
wallet instance and passphrase state chosen at connect time
(`requireSelectedDevice`, `requireResolvedSession`, `assertSessionIdentity`,
:24-62). It **fails closed** when a response omits `device` or its `state`.
Keep that invariant. Never weaken it to "no binding".

Unknown: in the Suite-hosted flow, does the response `device` carry `path`,
`instance` and `state` for `getFeatures`, `getDeviceState`, `getPublicKey`,
`getAddress` and `signTransaction`? If Suite omits them, signing fails
closed: safe, but broken.

**Trezor USB is disabled in production today.** All 50 Trezor rows in
`config/hardware-wallet-implementation-inventory.json` are `enabled: false`,
and `src/services/hardwareWallet/runtime.ts:19` notes the adapter is
"unreachable while Trezor capability rows are fail-closed". So Phase B can
ship without the spike: if Suite omits identity, signing fails closed, and
no operator can reach the flow anyway. Decided 2026-11-09 (user): implement
and release Phase B now, and test on real hardware later.

**Spike (gates enabling any Trezor capability row, not Phase A or B).** It
needs a real Trezor plus Suite desktop >= 26.7.2, and one run via Suite Web.
- Use a throwaway page on the canary stack, never prod.
- Log the raw response `device` for each of the 6 calls, on mainnet and
  testnet.
- Record the results here.
- Also check that testnet calls work through Suite. Suite may need testnet
  enabled in its settings. `selectAccount` rejects testnets, but we don't
  use it.

**Fallback binding**, if identity is absent or unstable. This is a user
decision, §9.
- Bind the session to the master fingerprint. `getMasterFingerprint`
  (trezorAdapter.ts:271-290) fetches `m/84'/0'/0'` and derives it with
  `masterFingerprintFromDescriptor`.
- Also bind to the account xpub.
- Re-verify both immediately before `signTransaction`; a mismatch aborts.
- The PSBT account binding (`src/services/hardwareWallet/psbtAccountBinding.ts`)
  and `assertRefTxAmountsMatch` stay as they are.

## 6. Delivery plan (two PRs, serial; both in the next release)

Why two PRs: a reviewed risk boundary.
- Phase A is a pure refactor, proven against the still-working v9 SDK and
  the unchanged v9 emulator proof.
- Phase B then swaps the SDK behind a seam that is already green.
- Phase B depends on Phase A. Merges are serial: A merges, then B rebases
  and re-runs CI.
- The §5 spike and the hardware acceptance gate *enabling* Trezor
  capability rows, not either phase. The emulator proof in CI
  (`verify-trezor-emulator`) remains a hard gate for both. The next release
  is cut after both phases are merged.

### Phase A — seam on v9 (no behavior change)

1. **Code.** Add `connectClient.ts` and the DTOs (§4.1). Inject the client
   into `trezorAdapter.ts`, route `signPsbt.ts` through it, and switch
   `sessionIdentity.ts` to the DTOs. Move all coin-label and result-shape
   handling into the client. The 5 v9-shape reads (§2) consume
   `TrezorCallResult`. `normalizeConnectResult` must keep every call site's
   current message and fallback semantics. For example, an absent error
   still yields `'Failed to connect to Trezor'` (trezorAdapter.ts:248-250)
   or `'Signing failed'` (signPsbtValidation.ts:35-37). The rewritten tests
   keep the same message assertions, e.g.
   `trezorSignPsbtValidation.branches.test.ts:94-97`.
   `getSerializedTrezorTx` changes from `result: any` to `TrezorCallResult`,
   and its test inputs move to that shape. Type the payload builders with the DTOs, removing
   the `any`s. Keep `debug: true`, `lazyLoad: false` and
   `coreMode: 'auto'` exactly as they are today (no behavior change).
2. **No dependency change**, so no churn in the lock, integrity or
   compatibility statement.
3. **ESLint guardrail**, in `config/tooling/eslint.config.js`.
   - Flat config replaces rule options per file. Any later block that sets
     `no-restricted-imports` for `src/**` drops the existing shared/
     restriction (:59-74). Block :137 and the :128 `off` show the pattern.
   - Hoist the shared/ pattern group into a `const`.
   - Add a `{ group: ['@trezor/**'], message }` pattern to the :59 entry.
   - Add a later block for
     `files: ['src/services/hardwareWallet/adapters/trezor/connectClient.ts']`
     that sets the rule with the shared/ group only.
   - Scope: the :59 entry sits in the `files: productionSource` block
     (eslint.config.js:4-10, :8). That covers `src/**`, `shared/**` and the
     server, gateway and proxy sources, but not `tests/**`. Tests that import
     `@trezor/*` stay legal; don't "fix" them.
   - Verify with a throwaway file importing `@trezor/connect-web`. It must
     be flagged. `connectClient.ts` must not be flagged. Delete the
     throwaway file afterwards.
4. **Tests.**
   - Rewrite the 6 SDK-mocking files to inject a fake client:
     - `tests/services/hardwareWallet.trezorAdapter.test.ts` (:52)
     - `tests/services/hardwareWallet.trezorAdapter.helpers.test.ts` (:15)
     - `tests/services/hardwareWallet.trezorAdapter.signingErrors.test.ts` (:22)
     - `tests/services/hardwareWallet.trezorAdapter.coinType.test.ts` (:19)
     - `tests/services/hardwareWallet.trezorSessionIdentity.test.ts` (:3)
     - `tests/services/hardwareWallet/trezorSignPsbtBranches/trezorSignPsbtBranchesTestHarness.ts`
       (:40, a device-echo shim at :40-47). It is used by the 4
       `*.contracts.ts` files there and by
       `tests/services/hardwareWallet/trezor.signPsbt.branches.test.ts`.
   - Also update `tests/services/hardwareWallet.trezorSignPsbtValidation.branches.test.ts`,
     which asserts the v9 `payload.error` shape. The 15 v9 `success: false`
     fixtures are spread across: signingErrors (2), trezorAdapter.test (10),
     SignPsbtValidation.branches (2), request-paths.contracts (1).
   - Payload-builder tests have no SDK import and should only need type
     updates:
     - `hardwareWallet.trezorSignPsbtPayloads.branches.test.ts`
     - `hardwareWallet.trezorMultisig.branches.test.ts`
     - `hardwareWallet/trezor.refTxs.branches.test.ts`
     - `hardwareWallet/trezor.test.ts`
   - `tests/config/trezorEmulatorProofConfig.test.ts:330-341` has
     source-text assertions that break when the imports move. The adapter
     must contain `import TrezorConnect from '@trezor/connect-web'` and
     `coreMode: 'auto'`, and `sessionIdentity.ts` must contain
     `from '@trezor/connect-web'`. Retarget them to `connectClient.ts`. The
     runtime checks at :333-336 (`init`, `getAddress`, `signTransaction`,
     `asDeviceUniquePath` are functions) stay valid.
   - Add the client contract test (§4.1.5). It must reach 100% of
     `connectClient.ts`.
5. **Emulator proof.** The contract (`config/trezor-emulator-proof.json`,
   schemaVersion 3, `bridge`, `connect` 9.7.3) stays unchanged, along with
   the fixtures and expected artifacts.
   - Add a test-only factory in `tests/integration/trezorEmulator/`. It
     builds a client from the in-process `@trezor/connect@9.7.3` core with
     the proof's settings (`transports: ["BridgeTransport"]`,
     `pendingTransportEvent: false`, `debug: false`, the manifest from test
     :310-317), and uses `normalizeConnectResult`.
   - Inject it with `new TrezorAdapter(client)`.
   - Route the test's direct `TrezorConnect.getAddress` (:137) through the
     factory client, so the coin mapping is shared.
   - Keep `TrezorConnect.dispose()` (:328) on the core singleton the factory
     wraps.
   - Keep the vitest alias (`config/tooling/vitest.trezor-emulator.config.ts:13`).
     The production `connectClient.ts` still imports `@trezor/connect-web`
     at module top level, and connect-web 9.7.3 has not been shown to load
     in Node. Revisit in Phase B step 4.
   - The test still reads the private `adapter.connection` (:243). Leave it.
6. **Changelog**: add an `[Unreleased]` entry (internal refactor; Trezor
   behavior unchanged).

**Phase A as built** (divergences from the steps above, for Phase B):
- `TrezorConnectClient` and the DTOs live in `adapters/trezor/types.ts`.
  `connectClient.ts` exports `createConnectWebClient`,
  `normalizeConnectResult`, `connectCoin`, `toConnectDevice` and
  `TREZOR_CONNECT_VERSION`; trezorAdapter.ts re-exports the version.
- DTO ↔ SDK compatibility is checked by tsc at the SDK call sites in
  `connectClient.ts`. No separate assertion type was needed.
- Exception: `signTransaction` casts `inputs` and `outputs`. Connect's
  declared types require `amount` on every input, while legacy inputs omit
  it and Connect reads the amount from refTxs. They also declare
  `multisig.pubkeys_order` as a numeric enum, while we send the enum name
  `'LEXICOGRAPHIC'`. Both forms work at runtime and the emulator proof
  covers them.
- **Phase B must re-check both fields against the v10 `.d.ts`,** and drop
  the cast if v10 matches.
- `refTxs`, device identity, `version`/`locktime` and all other calls are
  fully type-checked.
- `connectDevice()` returns `TrezorBoundDeviceIdentity` (with `state:
  string`). The client brands the path with `toConnectDevice()`.
- The emulator proof needs no separate factory. With the vitest alias,
  `new TrezorAdapter(createConnectWebClient(proofSettings))` is already the
  in-process core behind production normalization. The test's own direct
  `TrezorConnect.getAddress` and `dispose` calls stay until Phase B, which
  has to change their `coin: "Testnet"` label anyway. Route that call
  through `connectCoin` then.
- `signPsbtNetwork.ts` `detectNetwork()` coin labels (:13, :77) are only
  used by tests. The SDK never receives them, so they are not a Phase B
  coin site.
- The getFeatures failure log changed from `{ payload }` to
  `{ error: { message, code } }`. No user-visible text changed.
- Tests use `tests/services/hardwareWallet/trezorFakeClient.ts`
  (`createFakeTrezorClient`, `connectOk`, `connectFail`). The SDK mapping is
  pinned once, in `tests/services/hardwareWallet.trezorConnectClient.test.ts`,
  which covers `connectClient.ts` at 100%.
- Two adapter tests were converted:
  - the manifest-fallback test now covers only init short-circuiting; the
    fallback itself is in the client contract test;
  - the pinned-Bridge-settings test now checks that the adapter uses the
    injected client's `init()`; settings pass-through is in the contract
    test.

**Phase A done** (no hardware needed):
- All §7 "Both phases" commands pass.
- Forgejo CI is green, including `verify-trezor-emulator` and verify-vectors.
  The unchanged v9 proof still produces the same signed artifacts.
- `package.json`, `package-lock.json` and `config/trezor-emulator-proof.json`
  are byte-identical to main (`git diff --quiet origin/main -- <files>`).
- `grep -rln "@trezor/" src` lists only `connectClient.ts`.
- The ESLint throwaway check from step 3 flags a stray import.

### Phase B — Connect 10

1. **Dependencies.** These are funds-critical: `@trezor/` is a prefix in
   `config/signing-dependency-scope.json`, and both packages are in the
   `fundsCriticalPackages` of `config/ci-toolchain-lock.json`.
   - `scripts/bump-funds-critical.sh` takes one package per run and refuses
     a dirty tree (`:102-108`), so the plan file and Phase A must be
     committed first. The script asserts that the lock change stays within
     the target's dependency closure (`assert_lockfile_scope`, `:171-261`),
     so run the two bumps first, with nothing else edited, and commit after
     each:
     1. `scripts/bump-funds-critical.sh @trezor/connect-web 10.0.1 --dry-run`,
        then the same without `--dry-run`; commit.
     2. The same for `@trezor/connect 10.0.1`; commit.
     There is no order constraint between them: connect-web 10 does not
     depend on connect. Each run updates the version and integrity in
     `ci-toolchain-lock.json` and re-pins the compatibility statement
     (`:403-405`). It does **not** touch `config/trezor-emulator-proof.json`.
   - Then make these edits with npm commands only, never by hand on the
     lock:
     - move `@trezor/connect` to `devDependencies` (still `--save-exact`).
       `check-supply-chain-locks.mjs:291-293` reads dependencies and
       devDependencies alike, so `ci-toolchain-lock.json` needs no
       structural change;
     - add `@trezor/transport@10.0.1` as a devDependency only if the §B4
       option chosen needs it;
     - add root `overrides` `"axios": "1.21.1"`. Verify
       `node_modules/axios` in the lock is now 1.21.1. `npm install
       --package-lock-only` can report "up to date" and leave the old
       version when only `overrides` changed (see the header of
       `tests/ci/npmOverridesApplied.test.ts`).
   - Re-pin the compatibility statement by hand after those edits, because
     any `@trezor/*` lock change alters `signingDependencySha256`:
     `npx tsx scripts/ci/hardware-compatibility-report.ts --as-of "$(jq -r .generatedAt docs/reference/generated/hardware-wallet-compatibility.json)" --json docs/reference/generated/hardware-wallet-compatibility.json --markdown docs/reference/generated/hardware-wallet-compatibility.md`.
   - `config/trezor-emulator-proof.json`: set `connect` to 10.0.1, plus
     `connectIntegrity` and `connectWebIntegrity`; transport fields per B4.
   - `scripts/ci/npm-deprecation-allowlist.json`: the `trezor-stellar-base-14`
     entry (owner `root:@trezor/connect-web@9.7.3`) becomes unused, and
     `check-npm-deprecations.mjs:148-150` throws on unused entries, so it
     **must be removed**. The v10 core brings `@stellar/stellar-sdk@17`,
     which may carry new deprecations that need their own entries. Read the
     gate output.
   - `scripts/ci/npm-install-script-policy.json:109`: the
     `node_modules/@trezor/utxo-lib/node_modules/tiny-secp256k1` entry
     **must be deleted**. `check-npm-install-scripts.mjs:137` throws on
     stale locations. Add new entries only if the gate asks for them.
   - `.github/renovate.json` (:24-25, :57-58): keep the two packages in
     their group, and add `@trezor/transport` if it was added.
2. **Client implementation** (`connectClient.ts` only).
   - Init: `manifest { appName: 'Sanctuary', email, appUrl }`,
     `coreMode: 'auto'`. Drop `lazyLoad`.
   - `debug` changes from `true` to `false`. That is a deliberate behavior
     change; note it in the changelog.
   - Do **not** send an `appIcon` URL derived from the node's address (a
     privacy issue; hoseki removed the same). Whether to send a static icon
     is decision §9.2.
   - Map coins through `TrezorNetwork`.
   - Delete the v9 branch of `normalizeConnectResult` and its test cases.
   - Map `Method_Interrupted` and `Method_Cancel` to user-cancel messages.
   - Diff our DTOs against the v10 `.d.ts` for `signTransaction` inputs,
     outputs, refTxs, multisig and `script_type` enums, and for the
     `getPublicKey` fields we read (§2). Update the DTO compatibility
     check.
2a. **Verified v9 → v10 payload differences** (from the 10.0.1 sources,
   `@trezor/connect-core` / `connect-common` / `protobuf`, 2026-11-09). These
   are the changes the client and builders must make:
   - **Input `amount` is required on every input.** v10
     `connect-core/lib/api/bitcoin/inputs.js:14-16` has `required: true`. v9
     required it only when `script_type === 'EXTERNAL'` or for SegWit paths
     (`useAmount`). `buildTrezorInput` (signPsbtPayloads.ts) sets `amount`
     only from `witnessUtxo`, so legacy `SPENDADDRESS` inputs must take it
     from `nonWitnessUtxo.outs[prev_index].value`, validated with
     `validateSatoshiAmount`. Then make `TrezorSignInput.amount` required and
     drop that half of the cast.
   - **Device `state` is an object.** The `getDeviceState` result is
     `{ state: DeviceState }`, where `DeviceState = { sessionId?,
     staticSessionId?, deriveCardano? }`; v9 also had a string `state` and
     an `_state`. Response `device.state` is that object too
     (`connect-core/lib/core/index.js:104-108`), and a request's
     `device.state` must be the object (the core reads
     `state.staticSessionId`). `sessionIdentity.sessionState()` already
     accepts `{ staticSessionId }` on responses. In the client, send
     `state: { staticSessionId }` from our string; the DTO stays a string.
     Contract-test both directions.
   - **`multisig.pubkeys_order`** is the numeric enum `PROTO.MultisigPubkeysOrder`
     (`LEXICOGRAPHIC = 1`) in both versions. v10 encodes through bufbuild
     `fromJson`, which probably accepts the name, but that is not verified.
     In the client, map our `'LEXICOGRAPHIC'` to the numeric value and drop
     the rest of the cast.
   - `coin` is `CoinSymbol` (`btc`/`test`/`regtest`). Without `coin`,
     `getPublicKey` throws for paths it cannot classify. We always pass it.
   - Unchanged: script_type enums, the output union shape, the
     `signTransaction` result (`serializedTx`, `signatures`), the
     `getPublicKey` fields we read (v10 adds `displayablePublicKey`,
     `rootFingerprint?`), `getAddress.address`, and the `getFeatures` fields
     we read.
   - Emulator proof transport: `trezor-user-env` (@35adb3f) `bridge-start`
     offers `node-bridge` (its default, marked experimental, port 21328),
     `2.0.33` and `2.0.32`. v10 `BridgeTransport` takes only `{ port }`
     (default 21328) and does not reject trezord-go 2.0.33. So the smallest
     change is to keep `2.0.33` with `new BridgeTransport({ port: 21325 })`,
     though the changelog calls the legacy bridge unsupported. Prefer
     `node-bridge` on 21328 if it is stable in CI; fall back to 2.0.33 with
     a recorded reason.
   - `@trezor/connect-web@10.0.1` imports in plain Node 24 without `window`.
     Calls outside a browser are not proven, so keep the emulator vitest
     alias to the in-process core.
2b. **Phase B as built** (branch `feat/trezor-connect-10`):
   - Dependencies:
     - Both bumps; `@trezor/connect` moved to devDependencies; the `axios`
       override set to 1.21.1.
     - Explicit devDependencies for `@trezor/transport-common` (the proof's
       `BridgeTransport`) and `bip66` (BitBox test harness, previously only
       hoisted from Trezor 9).
     - `buffer@6.0.3` declared as a production dependency.
       `@keystonehq/bc-ur-registry` imports `buffer/` without declaring it;
       only `npm run build` caught this, not the tests.
     - The unused `toml` override removed (only Trezor 9 used it).
     - Stale entries removed: the install-script policy entries for
       stellar-sdk, blake-hash and tiny-secp256k1, the matching
       `allowScripts` entries, and deprecation allowlist entry
       `trezor-stellar-base-14`. `usb` re-pinned to 2.19.1 (dev-only).
   - The second bump could not use `scripts/bump-funds-critical.sh`. Its
     per-package lockfile-scope check rejects the dedupe of connect-web's
     nested `@trezor/*` copies. Its remaining steps ran by hand: the
     `ci-toolchain-lock.json` re-pin (integrity matches the registry), the
     compatibility re-pin, and `check:supply-chain-locks`.
   - Client:
     - `createConnectClient(sdk, initSettings)` holds the mapping;
       `createConnectWebClient` wraps it. The emulator proof passes the
       in-process `@trezor/connect` core, so it exercises the production
       mapping.
     - The `signTransaction` cast is gone; tsc now checks inputs and
       outputs, with `toConnectInput`/`toConnectOutput` encoding multisig.
     - The vitest alias is kept, as harmless.
   - Proof (corrected in CI, 2026-11-10):
     - trezord-go 2.0.33 rejects v10's JSON bridge protocol
       (`encoding/hex: invalid byte`), so the runner starts the image's
       `node-bridge` (container port 21328) and the contract `bridge`
       field is `node-bridge`. The test's local proxy keeps
       `BridgeTransport({ port: 21325 })`.
     - `pendingTransportEvent: true`: v10 `init()` otherwise returns before
       the device handshake.
     - The runner reads installed versions from disk, because v10's
       exports hide package.json.
     - The direct `getAddress` uses `connectCoin` and `toConnectMultisig`.
   - Server tests: the `@trezor/protobuf` round-trip smoke test was ported
     to v10's `protobufManager`. The replay harness's synthetic Trezor SDK
     tuple now uses the 10.0.1 integrities.
3. **Session binding**: unchanged and fail-closed. Revisit per the §5 spike
   before Trezor capability rows are enabled.
4. **Emulator proof** (the release-gating `verify-trezor-emulator` job,
   `.github/workflows/verify-vectors.yml:689`). The current runner uses the
   trezord-go Bridge 2.0.33 from the `trezor-user-env` image:
   - `run-trezor-emulator-proof.sh:560` is `bridge-start` with
     `TREZOR_BRIDGE`, and `:600-603` asserts `bridge_status.version`;
   - `:569` forwards to 21325, `:461-462` publishes only `9001/tcp` and
     `21326/tcp`, and `:606-617` is the TCP-only
     `docker-exec-tcp-forwarder.mjs` used on the rootless-Podman fleet.

   v10 does not support that bridge.

   **Option 1, preferred: keep the TCP forwarder path and run Trezor's new
   node bridge.**
   - Find out which bridge versions the pinned `trezor-user-env` image's
     controller offers for `bridge-start`. If none is the node bridge, move
     to a newer image digest (update `image`, `imageDigest`,
     `imageIndexDigest` and `imageConfigDigest`).
   - Use `new BridgeTransport({ ... })` from `@trezor/transport-common`
     (a dependency of `@trezor/connect`, so no new package) on the bridge
     port the runner exposes. The default is 21328; set it explicitly.
   - The contract `bridge` field keeps its meaning and gets the new version.

   **Option 2: `UdpTransport` (`@trezor/transport`) straight to the
   emulator.**
   - Nothing in the runner publishes UDP today. On Podman, UDP over
     `docker exec` needs a new forwarder.
   - The binding tests are coupled to the current strings:
     `tests/config/trezorEmulatorProofBinding.test.ts`,
     `tests/ci/dockerExecTcpForwarder.test.ts`,
     `resolve-trezor-forwarder-endpoints.test.sh` and
     `trezorEmulatorRunnerPreflight.test.ts`.
   - Option 2 costs much more. Use it only if Option 1 is impossible.

   Either way:
   - Keep the vitest alias or replace it. After the bump, the alias maps
     `@trezor/connect-web` to the v10 privileged core. If connect-web 10
     loads in Node, the alias can go once `connectClient.ts` imports it
     lazily. A lazy import may change the lazy `trezor-*.js` chunk, so
     re-measure it (B7).
   - Update `tests/config/trezorEmulatorProofConfig.test.ts`
     (`schemaVersion` at :73 and :84, versions at :114, and any
     transport-field checks).
   - Update `scripts/ci/hardware-compatibility-report.ts:375-380, :494-495`,
     which reads `trezor.bridge` and `trezor.connect` into
     `firmwareOrApp`/`sdk`, and `tests/ci/hardwareCompatibilityReport.test.ts`.
   - Re-validate the emulator source inventory.
   - Avoid editing `verify-vectors.yml`. Its provenance pin
     (`tests/scripts/verifyAddressesGenerated.test.ts`) covers that workflow
     and `scripts/verify-addresses/sourceManifest`, not the proof files. If
     you must edit it, regenerate the vectors in the same PR.
   - The proof runs only in CI. Never run Docker-heavy lanes on the host.
5. **UX copy.** Error text already says "ensure Trezor Suite is running".
   Surface the Suite >= 26.7.2 requirement and the Suite Web fallback in
   `src/components/ConnectDevice/UsbConnectionPanel/UsbInitialState.tsx`.
6. **Header regression test.** Assert that the nginx templates never emit
   `Cross-Origin-Opener-Policy: same-origin`, and that any CSP they emit
   includes `https://suite.trezor.io` in `frame-src`.
7. **Bundle.** The comment at `config/tooling/vite.config.ts:75-84` gives
   the lazy `trezor-*.js` chunk as about 530 KB, under the 5500
   `chunkSizeWarningLimit`. There is no `@trezor` manualChunks rule: :97
   splits only react and react-query. Measure after the bump and update the
   size in the comment.
8. **Docs and changelog.**
   - Update `docs/reference/hardware-wallet-integration.md` and
     `hardware-wallet-validation.md`: the Suite requirement, the new flow,
     and a Firefox note (no WebUSB, so Suite desktop is needed).
   - Add an `[Unreleased]` changelog entry that includes the `debug`
     change.
   - Close #537 with the audit evidence.

## 7. Verification (per PR, before push)

Worktree setup:
- Put it under `/home/nekoguntai`, not `/tmp`.
- Phase A can symlink `node_modules`. Phase B changes deps, so run a root
  `npm ci` in the worktree. Never run `server` `npm ci`.
- Run `cd shared && npm run build` and `cd server && npx prisma generate`.
- Get Node via `. ~/.nvm/nvm.sh; nvm use -s 24.22.2`. The pre-commit hook
  needs it too.

Both phases:

```bash
npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all
npx vitest run --coverage                  # 100% threshold; one coverage run at a time on this host
npm run lint
npm run quality:lizard                     # warnings <= 86
node scripts/generate-signer-inventory.mjs --check
npx vitest run --config config/tooling/vitest.config.ts tests/ci/signerInventoryGeneration.test.ts tests/ci/hardwareWalletImplementationInventory.test.ts tests/config/trezorEmulatorProofConfig.test.ts
node scripts/ci/hardware-emulator-source-inventory.mjs validate
node scripts/ci/check-wallet-safety-classifier.mjs
node scripts/ownership/check-lifecycle-callsites.mjs   # after git add
node --test tests/release/changelog-coverage.test.mjs
npm run arch:check                         # primary checkout only; expect no diff
node scripts/quality/check-large-files.mjs # in a clean temp worktree
```

Phase B adds the dependency-policy set (as `renovate-preflight.yml:67-72`
and `quality.yml:282-283` run them):

```bash
node scripts/ci/check-npm-install-scripts.mjs --verify-installed
node scripts/ci/check-supply-chain-locks.mjs
bash scripts/quality/check-lockfile-peer-resolution.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/npmOverridesApplied.test.ts tests/ci/hardwareCompatibilityReport.test.ts
node scripts/ci/check-npm-deprecations.mjs --install-log <log of the worktree's npm ci>
node scripts/ci/npm-audit-gate.mjs        # needs registry access; 0 high/critical
npm run test:dependency-compatibility
```

Note: the audit advisory endpoint can stall for hours. Probe it before
retrying.

Then:
- CI is green, including `verify-trezor-emulator`. Both PRs are
  wallet-safety-critical, so expect the full verify-vectors lane.
- **Before enabling any Trezor capability row (not part of this plan's
  release):** acceptance runs on the canary stack, never prod, with a real
  Trezor:
  - connect, xpub import, address verify and a singlesig sign through
    Suite desktop;
  - the same through Suite Web with desktop closed;
  - one multisig sign;
  - testnet.
- Then the next release through the normal RC flow.

Repo gotchas:
- Never name `package-lock.json` in a Bash call that also runs
  `npm`/`sed`/`python`/heredoc. A hook blocks it. Stage with `git add -u`.
- Don't use `git stash`; refs/stash is shared across worktrees.
- Don't commit while a coverage run is active.
- Merges are strictly serial; rebase only the next PR.
- No new Prisma migrations.

## 8. Rollback

Tags are immutable, so a rollback means shipping a patch that reverts Phase B
(re-pinning 9.7.3). That works only while `connect.trezor.io/9` is still
served. Phase A can stay in place on its own, because it works on v9.
Reverting A requires reverting B first.

## 9. Open decisions for the user

1. The session-binding fallback (§5), if Suite omits device identity.
2. Whether to send a static `appIcon` in the Suite prompt, or none.
3. ~~Release vehicle~~ Decided 2026-11-09: both phases ship in the next
   release, with #1496. Patch or minor (operators now need Suite) is decided
   at release prep.
4. Which Trezor device and Suite install to use for the §5 spike and the §7
   acceptance.

## 9b. Phase C (deferred, not in this release): enabling Trezor

Decided 2026-11-09 (user): this release ships Phases A and B with every
Trezor capability row still fail-closed. Enabling comes later, in its own
change. Facts that bind Phase C (verified on main @ ebd1766e4):

- **Only Tier 3 physical-device evidence can enable a row.**
  `docs/reference/hardware-wallet-validation.md`: "Tier 2 never satisfies a
  Tier 3 fixture row". The Trezor row says the emulator "cannot satisfy
  physical display/transport evidence". The release evaluator
  (`scripts/ci/hardware-compatibility-report.ts`, `enabledRowHasExactProof`)
  requires `evidenceTier: "physical-device"` plus fresh fixtures that match
  vendor, model, policy and capability.
- **Fixtures** use schema v5, live in
  `server/tests/fixtures/hardware-signed-psbt-vectors.ts`, and are per model.
  Each carries three Ed25519 receipts: Bitcoin Core acceptance, the Sanctuary
  capture, and a distinct reviewer. Each needs the address matrix
  (`/0/0`, `/0/1`, `/0/19`, `/0/999`, change), negative controls and runtime
  provenance (SDK tuple, firmware, host, Suite version), and must have been
  captured within the last 180 days.
- **Capture on Connect 10.** Evidence captured on 9.7.3 has the wrong SDK
  tuple. Trusted keys go in `config/hardware-physical-evidence-trust.json`,
  which is empty today, and the release runner needs the
  `HARDWARE_EVIDENCE_TRUST_SHA256` repository variable.
- **Code that must change:**
  - The row type and generator in `shared/constants/hardwareWalletCapabilities.ts`
    hard-code `enabled: false` and `evidenceTier: "unverified"`.
  - `server/src/services/hardwareWalletCapabilities.ts`
    `getHardwareWalletCapabilityDecision` always returns `allowed: false`.
  - Regenerate the inventory JSON and the compatibility docs, and update the
    tests that assert the rows stay disabled (listed in the research
    report: hardwareWalletCompatibility, hardwareCompatibilityReport,
    signerInventoryGeneration, hardwareWalletCapabilities, and
    deviceCapabilities).
- No vendor has ever been enabled, so Phase C sets the precedent.
- The §5 spike and the §7 real-device acceptance happen as part of this
  evidence capture.

## 9c. Phase C (this release): per-instance operator attestation

Decided 2026-11-09 (user): add an instance-scoped operator opt-in that
enables Trezor on that instance only. This is not Tier 3 and does not touch
the Tier 3 path. The static capability rows, the release evaluator
(`scripts/ci/hardware-compatibility-report.ts`) and the generated
compatibility statement stay unchanged, and stay fail-closed by default.

**Where the switch lives: the runtime env, which needs host access.** It is
deliberately not a feature flag or system setting, because those can be
flipped from an admin web session.
- `HARDWARE_WALLET_OPERATOR_ATTESTED_VENDORS=trezor`. Only `trezor` is
  accepted; any other vendor is ignored with a boot warning.
- `HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK=not-tier3-verified`, which must
  match exactly. Without it the vendor list is ignored, with a boot
  warning.
- Pass both through the backend `environment:` block in
  `docker-compose.yml` as `${VAR:-}`, following `PAYJOIN_PUBLIC_URL`, and
  parse them in `server/src/config`. `scripts/setup.sh` preserves
  operator-added keys across upgrades.

**Shared** (`shared/constants/hardwareWalletCapabilities.ts`): a pure
`resolveHardwareWalletCapability(identity, capability, attestedVendors)`
returning `{ row, enabled, evidence: 'unverified' | 'operator-attested' }`.
- It is enabled only when the row's vendor is attested and the model family
  is an exact catalog model, never `<vendor>-unresolved`.
- It covers all six capabilities, because the server also gates finalize and
  broadcast.
- `HARDWARE_WALLET_CAPABILITY_ROWS` stays frozen with `enabled: false`.

**Server** (`server/src/services/hardwareWalletCapabilities.ts`):
- `getHardwareWalletCapabilityDecision` gains an `allowed: true,
  evidenceTier: 'operator-attested'` branch, driven by config.
- The assert callsites and their counts do not change, so the signer
  inventory projection stays the same.
- Each attested allow is logged at warn level with vendor, model and
  capability, plus one boot warning while attestation is active.

**Client**:
- `GET /auth/me` gains an optional `hardwareWalletAttestation: { vendors }`.
  When it is absent the client treats the list as empty (fail-closed), so the
  e2e mock maps keep working.
- `src/services/hardwareWallet/service.ts` (`assertHardwareActionEnabled` and
  `requireApprovedAdapter`) and
  `src/components/send/steps/review/deviceCapabilities.ts` use the resolver.
- The identity-drift, fingerprint, PSBT account binding and artifact checks
  all run unchanged.
- The connect and signing UI shows "Operator-attested — not Tier 3
  verified" whenever an attested row is in use.

**Tests**:
- Server decision tests for:
  - off (unchanged `allowed: false`);
  - on with the ack;
  - on without the ack;
  - another vendor named;
  - the unresolved model;
  - a mixed-vendor wallet still blocked.
- Client service and deviceCapabilities tests, on and off.
- `/auth/me` contract tests.
- Unchanged: the compatibility-report and signer-inventory tests, which
  prove the global default.

**Enabling on prod** happens after the upgrade, by adding the two keys to
`~/.config/sanctuary/sanctuary.env` and restarting. That is an operator
action, done only when the user says so.

## 9a. Follow-up (not in this release): WebUSB without Suite

Running without Suite is the user's preferred end state (2026-11-09), but it
did not work about a year ago. Connect 10 supports it officially:
`@trezor/connect` runs its full core in the page, and
`@trezor/transport-web@10.0.1` exports `WebUsbTransport` (the v10
changelog lists the browser transport defaults as `[bridge, WebUSB]`).

- Add a second client, `createWebUsbClient()`, in `connectClient.ts`
  alongside the Suite client, plus an operator setting that selects between
  them. The adapter, signing code and tests stay unchanged; that is what the
  seam is for.
- Only a real device can validate it. The CI emulator transport is bridge or
  UDP, never WebUSB.
- Check these likely causes of the earlier failure first:
  - Suite or Bridge running at the same time and claiming the USB
    interface;
  - missing Trezor udev rules on Linux;
  - a non-Chromium browser (no WebUSB);
  - the page not served in a secure (HTTPS) context;
  - v9 not supporting an in-page core for third-party apps.
- Cost: the full core is a much larger lazy chunk than the thin client, and
  it brings the `axios` override (§3) into production dependencies.

## 10. Sources

- https://connect.trezor.io/10.0.0/guides/migrating-to-connect-10
- https://github.com/trezor/trezor-suite/issues/34334
- https://github.com/trezor/trezor-suite/pull/33222
- https://github.com/hoseki-inc/bitcoin-control-center/pull/326
- `@trezor/connect@10.0.1` CHANGELOG.md and `.d.ts` files from `npm pack`
  (`@trezor/connect-web`, `@trezor/connect-common`,
  `@trezor/transport-common`, `@trezor/transport`, all 10.0.1).

## 11. Review log

Pass 1 (3 parallel reviewers: source accuracy, deps/CI, Phase A
feasibility; every claim spot-checked by the coordinator). Accepted:
- the method count (6 plus a helper; not `unlockPath`; `dispose` is
  test-only);
- the 5th v9 error read (:248);
- 6 SDK-mock files, not 4, plus the source-text assertions in
  `trezorEmulatorProofConfig.test.ts`;
- payload-builder DTOs;
- the fingerprint derivation path (§5);
- `runtime.ts` lines and the v8-ignore;
- `debug: true` today;
- ESLint flat-config option replacement;
- keeping the vitest alias in Phase A;
- the signer, wallet-safety and emulator inventory gates;
- lizard 86;
- the bump script's one-package and clean-tree rules and lockfile scope;
- moving the dependency without a lock structural change;
- the compatibility re-pin command and the report's use of the bridge field;
- override verification;
- unused allowlist and policy entries fail CI, so they must be removed;
- the UDP option's real cost, so Option 1 is preferred;
- the full dependency-policy command set;
- a Phase A changelog entry;
- the rollback dependency.

Pass 2 (1 fresh reviewer, full re-read, every file:line spot-checked). Accepted:
- the signer inventory check command;
- the vite chunk facts (no `@trezor` manualChunks rule);
- keeping error messages and fallbacks through normalization;
- the DTO compatibility-check mechanism;
- the ESLint scope.

Pass 3 (1 fresh reviewer). Accepted: an explicit Phase A done definition,
and labelling the hardware acceptance as Phase B only.

Rejected in pass 2: an explicit regtest note (already covered by "every coin mapping").

Rejected in pass 1:
- a dependency-cruiser rule (no evidence of need);
- making Phase A ship in a separate release (the user decided one release).

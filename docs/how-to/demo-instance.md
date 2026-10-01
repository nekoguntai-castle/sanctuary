# Demo instance and docs screenshots

Seed a local Sanctuary stack with realistic, public wallet data, then regenerate
the README and documentation screenshots from it.

The demo data never involves private or operator wallets. Every key comes from a
published BIP39 test vector, so the screenshots can be shared freely. It also
keeps to the screenshot rules in
[hardware-wallet validation](../reference/hardware-wallet-validation.md) and the
[release-candidate canary](release-candidate-canary.md).

## What gets seeded

`scripts/demo/manifest.json` is the single source. It creates:

- **The `demo` login**: an administrator used for all screenshots. It is
  created inside the backend container, so you don't need the operator's
  admin password.
- **`alice` and `bob`**, plus a `Family` group.
- **Three watch-only mainnet wallets**, synced from the stack's configured
  Electrum server:

  | Wallet | Keys | Real on-chain history |
  |---|---|---|
  | Everyday spending | `abandon … about`, BIP84 | 236 transactions, 2019–2026 |
  | Taproot savings | `legal winner … yellow`, BIP86 | a few transactions |
  | Family vault (2-of-3) | the two above plus `letter advice … above`, BIP48 | one unspent 1,000 sat output |

- **Device names**: Coldcard Mk4, Trezor Safe 5, Ledger Flex. They stay
  watch-only, because the wallet-safety capability gate refuses hardware models
  that have no physical-device evidence.
- **A few transaction labels**.
- **Vault sharing**: alice is a signer and bob is an approver.
- **Feature flags** `aiAssistant`, `sanctuaryConsole` and `treasuryIntelligence`,
  so the AI and Console admin screens render. These flags are instance-wide;
  `reset` puts them back to their defaults.
- **A wallet agent**, "Payroll agent" (funding: Family vault, operational:
  Taproot savings), so the agent screens show a real row.

The release-candidate canary seeds a further 12 test-vector wallets on the same
login; see [Canary fleet](release-candidate-canary.md#canary-fleet).

Anyone can spend from these seeds, and bots sweep deposits within minutes, so
the single-sig balances sit near zero. Never send funds to them.
`tests/scripts/demoManifest.test.ts` re-derives every key from the listed
mnemonics, so the manifest cannot drift to a non-public key.

## Seed, inspect, reset

The stack itself is managed by `./start.sh` as usual. The demo scripts only add
or remove data.

```bash
npm run demo:seed     # idempotent; the first run creates config/demo/demo.local.env
npm run demo:status   # wallets, balances, sync state
npm run demo:reset    # delete the seeded agent, wallets, devices, users and group; reset the flags
node scripts/demo/demo.mjs reset --purge   # ...and the demo login itself
```

`config/demo/demo.local.env` is gitignored and holds the generated `demo`
password. Log in with it at `https://localhost:8443` to explore by hand.
To target another stack, set `SANCTUARY_DEMO_URL` and `SANCTUARY_PROJECT` there.
The template is `config/demo/demo.local.env.example`.

The first seed takes about a minute, mostly the Everyday spending sync.

Logins are limited to 5 per 15 minutes, successful ones included. So the CLI and
the capture tool each save their session next to the credentials, in
`config/demo/*.local.json`, which is gitignored and mode 0600. They log in again
only when that session has expired.

The seed refuses to modify an existing user that isn't the demo account (marked
by the email `demo@demo.invalid`). Pointing `DEMO_USERNAME` at a real account
cannot take it over. `reset` removes only the manifest's wallets, devices, users
and group.

## Capture screenshots

```bash
npx playwright install chromium   # once, if no browser is cached
npm run demo:capture              # every shot, dark and light
npm run demo:capture -- --grep dashboard
```

Shots are listed in `scripts/demo/capture/shots.json`:

- `route` can reference a seeded wallet as `{wallet:<name>}`.
- `click` opens a tab or button by its visible name.
- `overlay: "funded"` replaces only the wallet balances and the balance-history
  series with the figures in that file. Every other response is the live
  instance's real data. Use it for dashboard-style shots where zero balances
  would mislead the reader.

Each shot is written at 1440×900 @2x:

- `<name>.png`: dark theme, the default image.
- `<name>-light.png`: light theme.

Files go to `docs/assets/screenshots/`. Set `DEMO_SCREENSHOT_DIR` to write
somewhere else while iterating.

Capture runs against the Docker-hosted stack with a Playwright config that has
no `webServer`. It never starts `npm run dev`.

### Embedding

The README gets dark/light pairs; Forgejo and GitHub both render the `<picture>`:

```html
<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/screenshots/dashboard-light.png">
  <img src="docs/assets/screenshots/dashboard.png" alt="Dashboard" width="800">
</picture>
```

Pages under `docs/` embed the dark image with Markdown syntax:
`![Alt](../assets/screenshots/<name>.png)`. The Docusaurus site treats `.md`
as CommonMark and only bundles Markdown images, so a raw `<picture>` would break
there. Shots used only in docs set `"themes": ["dark"]` in `shots.json`, which
skips the light capture.

The README is generated: edit `scripts/templates/README.template.md`, then run
`scripts/generate-readme.sh`.

Some screens can't be shown with the demo data, so they have no shots:

- **Wallet Addresses tab**: the wallet-safety gate blocks address display for
  watch-only devices.
- **Console drawer**: it needs a configured model provider.
- **Intelligence**: it needs a configured model provider.

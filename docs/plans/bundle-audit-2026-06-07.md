# Bundle Audit — 2026-06-07

Follow-up to `reports/optimization-analysis-2026-06-07.md`'s **PR B** scope. Captures what `npm run build:analyze` actually showed once `rollup-plugin-visualizer` was wired in, so future audits don't re-litigate the same wrong assumptions.

## TL;DR

**The bundle is already well-split. PR B's original premise was wrong.**

- Initial preload set: **32 chunks, 370 KB total** (per `<link rel="modulepreload">` in `dist/index.html`).
- The largest chunks (`lib-*.js` 5.0 MB, `ledger-*.js` 920 KB, `trezor-*.js` 530 KB, `AreaChart-*.js` 320 KB, `WalletDetail-*.js` 270 KB) are **all lazy-loaded** behind dynamic-import boundaries.
- The 4.8 MB chunk the original audit blamed on `lucide-react` is in fact **100 % `bitbox02-api`**. Lucide is 22 KB in the entry chunk.
- `@yudiel/react-qr-scanner` is in a 137 KB chunk (`environment-*.js`) that's not preloaded — it only loads when a route that uses it is navigated.

So the planned "dynamic-import QR scanner" and "hardware-wallet lazy boundary" PR B actions yield ~zero net wins. They're already effectively lazy.

## What actually shipped (PR B as committed)

1. `rollup-plugin-visualizer` added as a devDep, gated behind `ANALYZE=1` so production builds stay deterministic.
2. New `build:analyze` npm script: `ANALYZE=1 vite build`. Writes `dist/stats.html` (treemap) and `dist/stats.json` (raw module → chunk attribution for scripted analysis).
3. `vite.config.ts` `chunkSizeWarningLimit` comment rewritten with the accurate explanation (lib chunk is bitbox02-api, lazy via `services/hardwareWallet/runtime.ts`).
4. The "DO NOT add to chunks" comment block in `manualChunks` updated to also explicitly call out hardware wallet SDKs (was only listing barrel-export / circular-dep cases).

That's it. No source files were dynamic-imported. Net diff: small.

## Chunk-by-chunk findings

### `lib-D67NEbrK.js` — 5,013 KB (uncompressed) / 1,433 KB gzip

100 % `bitbox02-api`. Reachable only from `bitbox-DprbjNl2.js`, `pathUtils-BfD_VU6z.js`, `signPsbt-CZzWKXsD.js`, which are themselves loaded only through the dynamic import in `services/hardwareWallet/runtime.ts:18-21`:

```ts
service.registerAdapterLoader('bitbox', async () => {
  const { BitBoxAdapter } = await import('./adapters/bitbox');
  return new BitBoxAdapter();
});
```

Not in the initial preload set. A user who never plugs in a BitBox02 never downloads it.

### `ledger-DOIRJrSd.js` — 942 KB / 246 KB gzip

Breakdown: `@ledgerhq/hw-app-btc` (327 KB), `@ledgerhq/psbtv2` (253 KB), `bitcoinjs-lib` (204 KB), `@bitcoinerlab/descriptors` (193 KB), `valibot` (178 KB), `@noble/curves` (140 KB), …

Lazy via `runtime.ts:8-11`. Not preloaded.

### `trezor-fsmX07Tz.js` — 534 KB / 119 KB gzip

Breakdown: `@sinclair/typebox` (296 KB, 31 %), `@trezor/protobuf` (211 KB, 22 %), `@trezor/connect` (114 KB, 12 %), `protobufjs` (107 KB, 11 %), …

Lazy via `runtime.ts:13-16`. Not preloaded.

### `AreaChart-D0K9-YQM.js` — 326 KB / 97 KB gzip

`recharts` (417 KB, 60 %), `@reduxjs/toolkit` (46 KB), `d3-scale` (27 KB), `d3-shape` (20 KB), `decimal.js-light` (25 KB), `immer` (16 KB), other `d3-*`.

Lazy — loaded only on routes that mount a chart (Dashboard, WalletList balance, WalletStats).

### `vendor-react-VjRhmdoo.js` — 178 KB / 57 KB gzip

98 % `react-dom`, 2 % `scheduler`. Preloaded (correctly — this is the runtime).

### `index-BRhS4R9J.js` — 222 KB / 65 KB gzip

The application entry. Top contributors:
- `components/*` (189 KB, 47 %)
- `vite-plugin-node-polyfills` (54 KB, 14 %)
- `src/*` (41 KB)
- `qrcode.react` (30 KB)
- `lucide-react` (22 KB)  ← significant: the audit overestimated this by ~200×
- `contexts/*` (18 KB)
- `hooks/*` (17 KB)
- `regenerator-runtime` (14 KB)

This is preloaded along with ~31 small supporting chunks for a 370 KB total cold-start payload, which is reasonable for an app of this scope.

## What this means for future PRs

1. **Skip the originally planned PR C — `lucide-react` codemod is no longer justified.** Lucide is 22 KB in the entry, not 4.8 MB. There's no win here.
2. **The "drop `chunkSizeWarningLimit` to 1000" plan is also misguided.** Three legitimately-large lazy chunks (lib 5 MB, ledger 920 KB, trezor 530 KB) would all warn. The warning would become noise instead of a regression signal. The current 5500 limit is correctly tuned to fire on a regression that pushes lib past its current ceiling.
3. **PR C (the render-perf one — memo + CurrencyContext split) is still real.** It's about render perf, not bundle size, so this audit doesn't affect it.

## How to re-audit

```bash
npm run build:analyze            # writes dist/stats.html + dist/stats.json
open dist/stats.html             # treemap; hover chunks to see gzip/brotli
python3 -c "                     # quick scripted attribution
import json
from collections import defaultdict
d = json.load(open('dist/stats.json'))
chunks = defaultdict(lambda: defaultdict(int))
def tl(mid):
    if '/node_modules/' in mid:
        nm = mid.split('/node_modules/',1)[1]
        p = nm.split('/')
        return '/'.join(p[:2]) if p[0].startswith('@') else p[0]
    return mid.lstrip('/').split('/')[0]
for uid, meta in d['nodeMetas'].items():
    for c, pk in meta.get('moduleParts', {}).items():
        chunks[c][tl(meta['id'])] += d['nodeParts'].get(pk, {}).get('renderedLength', 0)
for c, g in sorted(chunks.items(), key=lambda x:-sum(x[1].values()))[:5]:
    print(f'{c}: {sum(g.values())//1024} KB')
    for k, v in sorted(g.items(), key=lambda x:-x[1])[:5]:
        print(f'  {v//1024} KB  {k}')
"
```

To verify a chunk is lazy and not in the initial preload set:

```bash
grep "modulepreload" dist/index.html | grep <chunk-name>
# No match = lazy. Match = eagerly preloaded on cold start.
```

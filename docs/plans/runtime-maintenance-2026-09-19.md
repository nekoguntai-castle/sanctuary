# Runtime maintenance evidence

Node advances from 24.19.0 to 24.21.0 and npm from 11.19.0 to 11.19.1.
Registry publication dates are 2026-09-10 and 2026-08-26, respectively, so
both satisfy the three-day minimum release age. Exact Node archive SHA-256
and npm archive SHA-512 come from the publisher's SHASUMS256.txt and npm
registry integrity metadata; the image build checks both archives.

The coordinated update covers the local runtime pin, workflow/bootstrap
inventory, package manager declaration, Dockerfile npm version, emulator
runtime requirements and independent address-verifier Node lockfile.
The npm-only production Dockerfile changes were reviewed and their existing
OS-package-acquisition inventory hashes regenerated.

The runner-infra builder published the new image, which was then pulled back
by the registry's actual manifest digest and executed successfully:

```
nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go@sha256:5d2ffaef8be0c0e62e8ac522d2cccc9fbbe0494cc307264559025ba5ac130197
node v24.21.0
npm 11.19.1
go go1.27.1 linux/amd64
```

The Go security upgrade is retained. Every Go-runner workflow consumer and
both image inventories refer to this digest. The image is consumed directly
with `container.image`, so no fleet-wide runner restart is needed. Other
runner images retain their current pins; the shared bootstrap selects the
new checked runtime independently of those images' preinstalled Node version.

## Verification

- Supply-chain lock checker and its eight regression tests pass.
- Checksum bootstrap and exact runtime gate regression tests pass.
- Repeatable-verifier helper regression tests pass.
- All 730 workflow composition assertions pass.
- The full pinned address generator regenerates all 480 cases without any
  derived address/script/key changes. Only source digest and Node runtime
  provenance change in the generated fixtures.
- A second pinned verification run matches both regenerated fixtures byte for
  byte. Generation completed with signed cleanup state `cleaned`.

## Public image cooldown

Docker Hub tag metadata was inspected on 2026-09-20 UTC. These candidate
manifests have been published for less than three days and therefore retain
the existing reviewed pins:

| Image | Candidate digest | Tag last pushed (UTC) |
| --- | --- | --- |
| node:24-alpine | sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 | 2026-09-18T02:39:03Z |
| nginx:alpine | sha256:62ff2089abf5a9ed33bd232895bef5e22f7bb4b200675cec49a5ebc48e3d4ac8 | 2026-09-18T04:52:15Z |
| debian:bookworm-slim | sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 | 2026-09-19T02:24:42Z |
| postgres:16-alpine | sha256:3c5c8892d184f738f4fe282d14ddaa613a38f00f4189d2d94725ebe6f2909ddb | 2026-09-18T04:08:24Z |
| redis:7-alpine | sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7 | 2026-09-18T03:04:58Z |

The Debian/nginx/Postgres/Redis candidates exactly match #721's pending
entries. Their age is consistent with cooldown, although individual branch
check payloads have not been used to prove the bot's pending reason. Recheck
the same immutable digest after its three-day boundary and run the image /
install / retained-data checks before promotion. A newer moving tag starts
a fresh cooldown for its new digest. Production Node remains the old pinned
base until that image update is eligible; CI and verification use the new
checksum-locked Node runtime.

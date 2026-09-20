# Go verifier security upgrade evidence

The address verifier moves from Go 1.25.13 to 1.27.1 and from
`golang.org/x/crypto` 0.55.0 to 0.56.0. The module minimum becomes Go 1.26.0,
as required by x/crypto. Node 24.19.0, npm 11.19.0 and btcsuite versions remain
unchanged for this security batch.

## Publisher and image verification

Official Go download metadata supplied Linux amd64 archive SHA-256
`63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`.
The Go module proxy records Go 1.27.1 on 2026-08-28 and x/crypto 0.56.0 on
2026-09-02, both older than the repository release-age floor.

The existing runner-infra `build-runner-image.sh --image sanctuary-ci-go`
built and published the image on runner-sora with Docker-format Podman output.
The registry manifest was independently queried, then pulled by digest:

```
nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go@sha256:617c92760e1202713f16e84f70da4bda82765e42a32bfca1c42a639706629395
```

That registry pull executed Node 24.19.0, npm 11.19.0 and Go 1.27.1.
Podman's pre-push local RepoDigest differs after registry conversion; the
consumer pins above use the confirmed registry digest, not the builder's
printed local mapping. All five workflow consumers and both image inventories
use that digest. Container selection needs no runner-label changes.

## Verification

- `go test ./...` compiled the verifier successfully (the module has no Go unit tests).
- `go mod verify` verified every module checksum.
- Supply-chain lock checker and its eight regression tests passed.
- Repeatable-verifier helper regression tests passed.
- Workflow composition regression checks passed after installing their standalone parser dependency.
- The full pinned vector generator regenerated all 480 cases. All addresses,
  scripts, keys, network cases and multisig results are unchanged; the two
  generated fixtures change only source digest and Go runtime provenance.
- A second independent pinned `verify-repeatable.sh verify` run matched the
  regenerated fixtures byte for byte. Generation cleanup returned `cleaned`.

The OSV scanner inspected the updated go.mod. Its only remaining finding is
GO-2026-5932, the unmaintained `golang.org/x/crypto/openpgp` packages, for which
there is no fixed version. The scanner classifies it as not called. Independent
`go list -deps ./...` confirms that this verifier imports x/crypto's sha3,
ripemd160 and pbkdf2 packages, and no openpgp package. This is a documented
unreachable package finding, not a claim that the advisory was fixed.

## Baseline monitoring and remaining external work

[Security Monitor run 250](http://10.14.23.20:3000/nekoguntai-castle/security-monitoring-infra/actions/runs/250)
succeeded and refreshed #696 against Sanctuary main
`9c81f62fe9372c226740e8dfb10e947524a87c89`. It reports 0 critical, 30 high,
45 medium, 17 low, 6 unknown and 23 secret candidates (categories overlap),
with 17 suppressions. A final scan must target the merged upgrade commit.

The monitoring repository exposes only MONITOR_FORGEJO_TOKEN and RENOVATE_TOKEN
as repository secrets; the organization exposes no Renovate lookup secrets.
RENOVATE_GITHUB_COM_TOKEN and the dedicated read-only RENOVATE_NEXUS_USERNAME /
RENOVATE_NEXUS_PASSWORD pair therefore still need operator provisioning.
A publishing credential was used only transiently for this image publication;
it is not suitable for unattended read-only Renovate lookups.

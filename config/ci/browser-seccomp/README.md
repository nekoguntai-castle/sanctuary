# Podman browser policy revision 1

The base `podman-default.json` comes from the installed
`golang-github-containers-common` package used with Podman 5.4.2. Upstream:
https://github.com/containers/common, copyright 2018 containers/common authors,
Apache-2.0 (license included). Base SHA256:
`a37993729fdc03beeb0f00c5e31954a1a4412f7624d4672258ac6f5bd44a0ccb`.

`podman-chromium.json` is generated using
runner-infra’s `scripts/ops/browser-seccomp-profile.mjs`. SHA256:
`97fa67ad55ffa98b8fd918b8cd8693e8f5c2a409962318d9d02e33c72b58f363`.

Install through the managed procedure in runner-infra’s `docs/how-to/browser-sandbox.md`.
The installer refuses a host whose current default differs from the reviewed
base. This file does not replace any engine default. Consumers reference its
content-addressed host path only for isolated browser containers.

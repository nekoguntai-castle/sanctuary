# npm 12 toolchain migration

The repository now requires npm 12.0.2 through packageManager, engines and devEngines, CI workflow pins, Docker builder pins, emulator runtime manifests and the checksum-locked CI runner. Node remains 24.21.0: npm 12 supports Node ^24.15.0, while Node 26 does not enter LTS until October 28, 2026.

npm 12.0.2 was published July 29, 2026, beyond the three-day release cooldown. Its registry tarball was independently downloaded and SHA-512 verified against registry integrity:

`b885e890b9418fa1693544d05f53e64f9a73ec194837d4258b15fecdd692347b1dd2a517b1b0cbaf9d31cd8e92c3b70956bd2ecc72833a57b4b3098f5bfa7943`

The runner was built and published through runner-infra's existing build-runner-image script, then pulled by immutable digest and executed on Linux:

`nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go@sha256:00c4092dc9e30c242c4d1acb69f3c223e983932b9595752ac435385a6801a2b0`

Actual runtimes: Node 24.21.0, npm 12.0.2, Go 1.27.1. No fleet label or host runtime change is required.

## Compatibility review

The [npm 12 release notes](https://github.com/npm/cli/releases/tag/v12.0.0) describe default-blocked dependency lifecycle scripts and stricter configuration handling. Sanctuary already uses explicit allowScripts decisions and strict-allow-scripts. The real Linux clean install retained that policy; no wildcard approval, ignore-scripts substitution for the normal install, or forced dependency resolution was introduced. The policy checker verified thirteen packages and three version-pinned approved scripts.

The removed shrinkwrap behavior does not affect the checked-in package-lock v3 files. Regenerating the root lockfile with npm 12 changed only the npm engine metadata, preserving every dependency version and integrity. The clean install left the lockfile byte-for-byte unchanged. No executable repository callers rely on the changed npm view/pkg/pack JSON output. Dependencies use registry artifacts, so the new default restrictions on arbitrary Git and remote URL installs require no exception.

The LLM Docker builder previously inherited the base image's npm; it now installs the same pinned version. Its deprecated prune --production invocation becomes --omit=dev. Production images continue to omit global npm/npx. Reviewed OS package-acquisition commands and repositories are unchanged; Dockerfile review hashes were refreshed after reviewing these package-manager-only edits.

## Verification

- Published runner repull and real Linux runtime execution.
- Root clean install with strict lifecycle policy; unchanged lockfile SHA-256.
- Checksum bootstrap tests, including bad-checksum/drift rejection, and toolchain gate tests.
- Eight supply-chain tests, including package/integrity, runner-parent and toolchain drift rejection.
- 730 workflow composition checks, plus preparation/parser and Podman composition guards.
- Shared package build and Prisma client generation.
- Eighteen Trezor runtime preflight/configuration tests.
- Clean installs of both independent verifier projects.
- LLM proxy clean install, TypeScript build and production prune.
- Actual npm 11.19.1 invocation rejected by devEngines with EBADDEVENGINES.

Final combined address-source provenance must be regenerated after all verifier inputs are stable, because verify-vectors.yml is a material source input. This batch does not hand-edit fixture hashes. Full combined image/emulator CI remains the integration gate.

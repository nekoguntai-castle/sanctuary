# Offline Release Keys

`sanctuary-offline-release-public.pem` is the pinned public key used by
`install.sh --offline-bundle` when verifying official offline bundles.
If that file has not been provisioned in a checkout yet, operators must pass a
separately trusted key with `--offline-public-key` or
`SANCTUARY_OFFLINE_PUBLIC_KEY`.

Do not commit the matching private key. Release bundle creation must receive
the private key through `--signing-key` or `SANCTUARY_OFFLINE_SIGNING_KEY`.

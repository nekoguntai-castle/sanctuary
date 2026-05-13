/**
 * PHASE D — failing non-regression test for audit 2026-05-12
 *
 * Finding: server/src/api/transactions/broadcastIntent.ts:176
 *   `resolveSignedPsbtRecipientAndAmount()` evaluates only the FIRST external
 *   output of a signed PSBT. PSBT broadcast handlers then pass that single
 *   {recipient, amount} pair into `assertPolicyAllowsBroadcast()`. Multi-output
 *   PSBTs therefore bypass spend-limit / whitelist policies on outputs 2+.
 *
 *   The raw-hex broadcast path rejects multi-recipient transactions; the
 *   signed-PSBT path silently accepts them. That asymmetry is the bug.
 *
 * Why this is `it.todo` rather than `test.fails(...)`:
 *
 *   Reproducing the bypass end-to-end requires a VALID signed multi-output
 *   PSBT that:
 *
 *     - spends a UTXO belonging to the route wallet (so the broadcast handler
 *       doesn't reject earlier on the wallet-input integrity check — see the
 *       sibling HIGH finding at broadcastIntent.ts:209),
 *     - has output #1 paying a wallet-policy-approved external address with
 *       an amount inside the spend limit,
 *     - has output #2 paying a DIFFERENT external address (or the same
 *       address with a value that exceeds the spend-limit / violates the
 *       whitelist),
 *     - is signed with a key whose witness/signature validates against the
 *       UTXO's scriptPubKey,
 *     - and is encoded as base64 ready for `txService.getPSBTInfoWithNetwork`.
 *
 *   The repo has signed-PSBT vectors in
 *   `server/tests/fixtures/generated-signed-psbt-vectors.ts` and
 *   `hardware-signed-psbt-vectors.ts`, but none of the existing fixtures are
 *   two-external-output transactions. Synthesizing a valid one requires
 *   bitcoinjs-lib (already in deps) to:
 *
 *     1. derive a wallet/address pair from a known test xprv,
 *     2. seed prisma with a UTXO + Address + WalletDevice for that wallet,
 *     3. build a `Psbt` with one input (the seeded UTXO) and two TxOutputs
 *        to non-wallet addresses,
 *     4. sign the input with the matching private key and finalise,
 *     5. base64-encode and submit via supertest.
 *
 *   That is a multi-hour fixture-engineering task and is the infrastructure
 *   gap called out in the audit Phase D report. Until that fixture exists,
 *   this `it.todo` carries the specification.
 *
 * Test plan when the fixture is available:
 *
 *   - Create wallet W with a strict policy: e.g. spending_limit = 10_000 sats
 *     OR address whitelist = [allowedAddr].
 *   - Seed prisma with a confirmed UTXO of >= 20_000 sats owned by W and an
 *     Address row matching the UTXO's scriptPubKey.
 *   - Build a signed PSBT spending that UTXO with:
 *        output 1 -> allowedAddr,    5_000 sats  (policy-OK)
 *        output 2 -> attackerAddr,  12_000 sats  (policy-VIOLATION)
 *        change   -> change addr of W
 *   - POST `/api/v1/wallets/<W.id>/psbt/broadcast` with
 *     { signedPsbtBase64: <base64> } as wallet W's owner.
 *   - Expect status 4xx (policy reject) AND no entry in the broadcast/tx tables.
 *   - On main this currently returns 200 because only output 1 (allowedAddr,
 *     5_000) is evaluated against the policy. The fix must aggregate or
 *     reject multi-external-output PSBTs before reaching `broadcastAndSave()`.
 *
 *   Once the fixture exists, replace this `it.todo` with `test.fails(...)`
 *   that wires the steps above through the integration harness (see
 *   `walletApprovalsAudit.test.ts` for the harness pattern).
 */

import { describe, it } from 'vitest';

describe('PSBT broadcast — audit 2026-05-12 multi-output policy bypass', () => {
  it.todo(
    'POST /:walletId/psbt/broadcast rejects a signed PSBT whose 2nd external output violates wallet policy ' +
      '(see file header for the exact fixture spec — blocked on missing multi-output signed-PSBT fixture)',
  );
});

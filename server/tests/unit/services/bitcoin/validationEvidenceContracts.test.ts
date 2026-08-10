import { describe, expect, it } from 'vitest';
import {
  BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE,
  BITCOIN_VALIDATION_EVIDENCE_POLICY,
  BITCOIN_VALIDATION_EVIDENCE_SCOPES,
} from '../../../../src/services/bitcoin/validationEvidenceContracts';

describe('Bitcoin validation evidence contracts', () => {
  it('keeps external evidence lab-scoped unless the runtime explicitly supports it', () => {
    expect(BITCOIN_VALIDATION_EVIDENCE_POLICY).toEqual({
      supportedProductionBackends: ['electrum'],
      externalEvidenceDefault: 'lab_evidence_only',
      runtimeExpansionRequires: 'explicit_supported_backend_or_product_feature',
    });
  });

  it('declares every current Bitcoin evidence area with a runtime boundary', () => {
    expect(BITCOIN_VALIDATION_EVIDENCE_SCOPES.map(scope => scope.area)).toEqual([
      'broadcast_preflight',
      'address_vector_verification',
      'psbt_fixture_verification',
      'hardware_fixture_intake',
    ]);

    for (const scope of BITCOIN_VALIDATION_EVIDENCE_SCOPES) {
      expect(scope.runtimeRequirements.length).toBeGreaterThan(0);
      expect(scope.labEvidenceOnly.length).toBeGreaterThan(0);
      expect(scope.notRuntimeRequirements.length).toBeGreaterThan(0);
    }
  });

  it('prevents lab evidence from also being declared as a runtime requirement', () => {
    for (const scope of BITCOIN_VALIDATION_EVIDENCE_SCOPES) {
      const runtimeRequirements = new Set<string>(scope.runtimeRequirements);
      expect(
        scope.labEvidenceOnly.filter(evidence => runtimeRequirements.has(evidence)),
      ).toEqual([]);
    }
  });

  it('keeps Bitcoin Core as lab evidence for all Core-backed validation areas', () => {
    const coreBackedScopes = BITCOIN_VALIDATION_EVIDENCE_SCOPES.filter(scope =>
      scope.labEvidenceOnly.some(evidence => evidence.startsWith('bitcoin_core_')),
    );

    expect(coreBackedScopes.map(scope => scope.area)).toEqual([
      'broadcast_preflight',
      'address_vector_verification',
      'psbt_fixture_verification',
      'hardware_fixture_intake',
    ]);

    for (const scope of coreBackedScopes) {
      expect(scope.notRuntimeRequirements).toEqual(
        expect.arrayContaining(['bitcoin_core_rpc', 'bitcoind']),
      );
      expect(scope.runtimeRequirements).not.toEqual(
        expect.arrayContaining(['bitcoin_core_rpc', 'bitcoind']),
      );
    }
  });

  it('pins the Electrum broadcast preflight scope used by broadcast contracts', () => {
    expect(BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE).toEqual({
      area: 'broadcast_preflight',
      runtimeRequirements: [
        'configured_electrum_backend',
      ],
      verifiesBeforePropagation: [
        'raw_transaction_parseable',
        'previous_transactions_fetchable',
        'previous_outputs_exist',
        'previous_outputs_have_standard_addresses',
        'previous_outputs_are_still_unspent',
      ],
      labEvidenceOnly: [
        'bitcoin_core_testmempoolaccept',
        'bitcoin_core_decoderawtransaction',
      ],
      notRuntimeRequirements: [
        'bitcoin_core_rpc',
        'bitcoind',
      ],
    });
  });
});

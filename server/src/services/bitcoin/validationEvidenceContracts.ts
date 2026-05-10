export type BitcoinEvidenceArea =
  | 'broadcast_preflight'
  | 'address_vector_verification'
  | 'psbt_fixture_verification'
  | 'hardware_fixture_intake';

export interface BitcoinValidationEvidenceScope {
  area: BitcoinEvidenceArea;
  runtimeRequirements: readonly string[];
  labEvidenceOnly: readonly string[];
  notRuntimeRequirements: readonly string[];
}

export const BITCOIN_VALIDATION_EVIDENCE_POLICY = {
  supportedProductionBackends: ['electrum'],
  externalEvidenceDefault: 'lab_evidence_only',
  runtimeExpansionRequires: 'explicit_supported_backend_or_product_feature',
} as const;

export const BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE = {
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
} as const;

export const BITCOIN_VALIDATION_EVIDENCE_SCOPES = [
  BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE,
  {
    area: 'address_vector_verification',
    runtimeRequirements: [
      'sanctuary_address_derivation',
    ],
    labEvidenceOnly: [
      'bitcoin_core_key_io_vectors',
      'caravan_address_vectors',
      'bip_utils_address_vectors',
    ],
    notRuntimeRequirements: [
      'bitcoin_core_rpc',
      'bitcoind',
      'caravan_runtime',
      'python_bip_utils_runtime',
    ],
  },
  {
    area: 'psbt_fixture_verification',
    runtimeRequirements: [
      'sanctuary_psbt_parser',
      'sanctuary_psbt_finalizer',
    ],
    labEvidenceOnly: [
      'bitcoin_core_decodepsbt',
      'bitcoin_core_finalizepsbt',
      'bitcoin_core_testmempoolaccept',
    ],
    notRuntimeRequirements: [
      'bitcoin_core_rpc',
      'bitcoind',
    ],
  },
  {
    area: 'hardware_fixture_intake',
    runtimeRequirements: [
      'supported_hardware_adapter_when_user_selects_hardware_signing',
    ],
    labEvidenceOnly: [
      'physical_lab_device_artifacts',
      'bitcoin_core_testmempoolaccept',
    ],
    notRuntimeRequirements: [
      'lab_device_farm',
      'bitcoin_core_rpc',
      'bitcoind',
    ],
  },
] as const satisfies readonly BitcoinValidationEvidenceScope[];

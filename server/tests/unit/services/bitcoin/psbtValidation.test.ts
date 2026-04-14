import { describe } from 'vitest';
import { registerPsbtCloneMergeEdgeContracts } from './psbtValidation/psbtValidation.clone-merge-edge.contracts';
import { registerPsbtExtractionMetricsContracts } from './psbtValidation/psbtValidation.extraction-metrics.contracts';
import { registerPsbtParseStructureContracts } from './psbtValidation/psbtValidation.parse-structure.contracts';
import { registerPsbtPayjoinContracts } from './psbtValidation/psbtValidation.payjoin.contracts';

describe('PSBT Validation Utilities', () => {
  registerPsbtParseStructureContracts();
  registerPsbtPayjoinContracts();
  registerPsbtExtractionMetricsContracts();
  registerPsbtCloneMergeEdgeContracts();
});

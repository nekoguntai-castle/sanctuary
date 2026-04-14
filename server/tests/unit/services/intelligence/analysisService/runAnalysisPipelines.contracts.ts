import { describe } from 'vitest';
import { registerRunAnalysisConfigUtxoContracts } from './runAnalysis.config-utxo.contracts';
import { registerRunAnalysisErrorDedupContracts } from './runAnalysis.error-dedup.contracts';
import { registerRunAnalysisFeeAnomalyContracts } from './runAnalysis.fee-anomaly.contracts';
import { registerRunAnalysisTaxConsolidationContracts } from './runAnalysis.tax-consolidation.contracts';

export function registerRunAnalysisPipelinesContracts(): void {
  // ========================================
  // runAnalysisPipelines
  // ========================================

  describe('runAnalysisPipelines', () => {
    registerRunAnalysisConfigUtxoContracts();
    registerRunAnalysisFeeAnomalyContracts();
    registerRunAnalysisTaxConsolidationContracts();
    registerRunAnalysisErrorDedupContracts();
  });
}

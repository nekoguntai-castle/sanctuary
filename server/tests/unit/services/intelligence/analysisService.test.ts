import { beforeEach, describe } from 'vitest';
/**
 * Analysis Service Tests
 *
 * Tests for the Treasury Intelligence analysis pipeline orchestration.
 */

import { registerIntelligenceStatusContracts } from './analysisService/intelligenceStatus.contracts';
import { registerRunAnalysisPipelinesContracts } from './analysisService/runAnalysisPipelines.contracts';
import { setupAnalysisServiceMocks } from './analysisService/analysisServiceTestHarness';

describe('Analysis Service', () => {
  beforeEach(setupAnalysisServiceMocks);

  registerRunAnalysisPipelinesContracts();
  registerIntelligenceStatusContracts();
});

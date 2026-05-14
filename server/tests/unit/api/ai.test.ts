import { describe } from 'vitest';

import {
  registerAuthenticationContracts,
  registerRateLimitingContracts,
} from './ai/ai.auth-rate.contracts';
import {
  registerDetectOllamaContracts,
  registerListModelsContracts,
  registerRemovedModelManagementRouteContracts,
} from './ai/ai.models.contracts';
import { registerAiStatusContracts } from './ai/ai.status.contracts';
import {
  registerNaturalQueryContracts,
  registerSuggestLabelContracts,
} from './ai/ai.suggest-query.contracts';
import { registerAiApiTestHarness } from './ai/aiTestHarness';

describe('AI API Routes', () => {
  registerAiApiTestHarness();

  describe('GET /api/v1/ai/status', () => {
    registerAiStatusContracts();
  });

  describe('POST /api/v1/ai/suggest-label', () => {
    registerSuggestLabelContracts();
  });

  describe('POST /api/v1/ai/query', () => {
    registerNaturalQueryContracts();
  });

  describe('POST /api/v1/ai/detect-ollama', () => {
    registerDetectOllamaContracts();
  });

  describe('GET /api/v1/ai/models', () => {
    registerListModelsContracts();
  });

  describe('Removed model-management routes', () => {
    registerRemovedModelManagementRouteContracts();
  });

  describe('Authentication', () => {
    registerAuthenticationContracts();
  });

  describe('Rate Limiting', () => {
    registerRateLimitingContracts();
  });
});

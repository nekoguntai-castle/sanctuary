import { describe } from 'vitest';

import {
  registerAuthenticationContracts,
  registerRateLimitingContracts,
} from './ai/ai.auth-rate.contracts';
import {
  registerOllamaContainerStartContracts,
  registerOllamaContainerStatusContracts,
  registerOllamaContainerStopContracts,
} from './ai/ai.container.contracts';
import {
  registerDeleteModelContracts,
  registerDetectOllamaContracts,
  registerListModelsContracts,
  registerPullModelContracts,
} from './ai/ai.models.contracts';
import { registerAiStatusContracts } from './ai/ai.status.contracts';
import {
  registerNaturalQueryContracts,
  registerSuggestLabelContracts,
} from './ai/ai.suggest-query.contracts';
import { registerSystemResourcesContracts } from './ai/ai.system-resources.contracts';
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

  describe('POST /api/v1/ai/pull-model', () => {
    registerPullModelContracts();
  });

  describe('DELETE /api/v1/ai/delete-model', () => {
    registerDeleteModelContracts();
  });

  describe('Ollama Container Management', () => {
    describe('GET /api/v1/ai/ollama-container/status', () => {
      registerOllamaContainerStatusContracts();
    });

    describe('POST /api/v1/ai/ollama-container/start', () => {
      registerOllamaContainerStartContracts();
    });

    describe('POST /api/v1/ai/ollama-container/stop', () => {
      registerOllamaContainerStopContracts();
    });
  });

  describe('GET /api/v1/ai/system-resources', () => {
    registerSystemResourcesContracts();
  });

  describe('Authentication', () => {
    registerAuthenticationContracts();
  });

  describe('Rate Limiting', () => {
    registerRateLimitingContracts();
  });
});

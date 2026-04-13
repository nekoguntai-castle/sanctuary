/**
 * AI API Path Definitions
 *
 * OpenAPI path definitions for public AI assistant endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const aiPaths = {
  '/ai/status': {
    get: {
      tags: ['AI'],
      summary: 'Get AI status',
      description: 'Check whether AI is enabled and whether the configured model endpoint is reachable.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('AI status', '#/components/schemas/AIStatusResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/suggest-label': {
    post: {
      tags: ['AI'],
      summary: 'Suggest transaction label',
      description: 'Request an AI-generated label suggestion for a transaction.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AISuggestLabelRequest'),
      responses: {
        200: jsonResponse('Label suggestion', '#/components/schemas/AISuggestLabelResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        503: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/query': {
    post: {
      tags: ['AI'],
      summary: 'Execute natural language query',
      description: 'Request a structured query result for a wallet-scoped natural-language prompt.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AIQueryRequest'),
      responses: {
        200: jsonResponse('Structured query result', '#/components/schemas/AIQueryResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        503: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/detect-ollama': {
    post: {
      tags: ['AI'],
      summary: 'Detect Ollama endpoint',
      description: 'Ask the isolated AI container to detect a local or configured Ollama endpoint.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Ollama detection result', '#/components/schemas/AIDetectOllamaResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/models': {
    get: {
      tags: ['AI'],
      summary: 'List AI models',
      description: 'List models available through the configured AI endpoint.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Available AI models', '#/components/schemas/AIModelsResponse'),
        401: apiErrorResponse,
        502: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/pull-model': {
    post: {
      tags: ['AI'],
      summary: 'Pull AI model',
      description: 'Admin-only request to pull or download a model through the configured AI endpoint.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AIModelRequest'),
      responses: {
        200: jsonResponse('Model pull result', '#/components/schemas/AIModelOperationResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        502: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/delete-model': {
    delete: {
      tags: ['AI'],
      summary: 'Delete AI model',
      description: 'Admin-only request to delete a model through the configured AI endpoint.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AIModelRequest'),
      responses: {
        200: jsonResponse('Model delete result', '#/components/schemas/AIModelOperationResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        502: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/ollama-container/status': {
    get: {
      tags: ['AI'],
      summary: 'Get bundled Ollama container status',
      description: 'Get Docker-proxy-backed status for the bundled Ollama container.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Ollama container status', '#/components/schemas/AIContainerStatusResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/ollama-container/start': {
    post: {
      tags: ['AI'],
      summary: 'Start bundled Ollama container',
      description: 'Start the bundled Ollama container through the restricted Docker socket proxy.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Ollama container start result', '#/components/schemas/AIContainerActionResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/ollama-container/stop': {
    post: {
      tags: ['AI'],
      summary: 'Stop bundled Ollama container',
      description: 'Stop the bundled Ollama container through the restricted Docker socket proxy.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Ollama container stop result', '#/components/schemas/AIContainerActionResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/ai/system-resources': {
    get: {
      tags: ['AI'],
      summary: 'Get AI system resources',
      description: 'Check RAM, disk, and GPU availability before enabling local AI features.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('AI system resources', '#/components/schemas/AISystemResourcesResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;

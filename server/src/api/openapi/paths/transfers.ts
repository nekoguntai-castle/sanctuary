/**
 * Transfer API Path Definitions
 *
 * OpenAPI path definitions for authenticated ownership transfer endpoints.
 */

import {
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_ROLE_FILTER_VALUES,
  TRANSFER_STATUS_FILTER_VALUES,
} from '../../../services/transferService/types';
import { browserOrBearerAuth as bearerAuth } from '../security';

const transferIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

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

const optionalJsonRequestBody = (schemaRef: string) => ({
  required: false,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const transferResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/OwnershipTransfer' },
    },
  },
});

export const transferPaths = {
  '/transfers': {
    get: {
      tags: ['Transfers'],
      summary: 'List ownership transfers',
      description: 'Get ownership transfers involving the authenticated user.',
      security: bearerAuth,
      parameters: [
        {
          name: 'role',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...TRANSFER_ROLE_FILTER_VALUES], default: 'all' },
        },
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...TRANSFER_STATUS_FILTER_VALUES], default: 'all' },
        },
        {
          name: 'resourceType',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...TRANSFER_RESOURCE_TYPES] },
        },
      ],
      responses: {
        200: {
          description: 'Ownership transfers',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TransferListResponse' },
            },
          },
        },
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Transfers'],
      summary: 'Initiate ownership transfer',
      description: 'Start a wallet or device ownership transfer to another user.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TransferCreateRequest'),
      responses: {
        201: transferResponse('Transfer initiated'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/counts': {
    get: {
      tags: ['Transfers'],
      summary: 'Get transfer counts',
      description: 'Get pending incoming and awaiting-confirmation transfer counts.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Transfer counts',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TransferCountsResponse' },
            },
          },
        },
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/{id}': {
    get: {
      tags: ['Transfers'],
      summary: 'Get ownership transfer',
      description: 'Get a transfer by ID when the authenticated user is the initiator or recipient.',
      security: bearerAuth,
      parameters: [transferIdParameter],
      responses: {
        200: transferResponse('Transfer details'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/{id}/accept': {
    post: {
      tags: ['Transfers'],
      summary: 'Accept ownership transfer',
      description: 'Accept a pending transfer as the recipient.',
      security: bearerAuth,
      parameters: [transferIdParameter],
      responses: {
        200: transferResponse('Transfer accepted'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/{id}/decline': {
    post: {
      tags: ['Transfers'],
      summary: 'Decline ownership transfer',
      description: 'Decline a pending transfer as the recipient.',
      security: bearerAuth,
      parameters: [transferIdParameter],
      requestBody: optionalJsonRequestBody('#/components/schemas/TransferDeclineRequest'),
      responses: {
        200: transferResponse('Transfer declined'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/{id}/cancel': {
    post: {
      tags: ['Transfers'],
      summary: 'Cancel ownership transfer',
      description: 'Cancel a pending or accepted transfer as the initiator.',
      security: bearerAuth,
      parameters: [transferIdParameter],
      responses: {
        200: transferResponse('Transfer cancelled'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transfers/{id}/confirm': {
    post: {
      tags: ['Transfers'],
      summary: 'Confirm ownership transfer',
      description: 'Confirm an accepted transfer as the initiator and execute the ownership change.',
      security: bearerAuth,
      parameters: [transferIdParameter],
      responses: {
        200: transferResponse('Transfer confirmed'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;

import { expect, it } from 'vitest';

import {
  expectDocumentedMethod,
  openApiSpec,
  type OpenApiPathKey,
} from './openapi.helpers';

export function registerOpenApiSupportIncidentTests() {
  it('documents separate incident-profile and controlled-capture routes', () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ['/admin/support-package/incident', 'post'],
      ['/admin/support-package/incident-capture', 'get'],
      ['/admin/support-package/incident-capture', 'post'],
      ['/admin/support-package/incident-capture', 'delete'],
    ];
    for (const [path, method] of routes) expectDocumentedMethod(path, method);

    const incident = openApiSpec.paths['/admin/support-package/incident'].post;
    expect(incident.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminIncidentSupportPackageRequest',
    });
    expect(Object.keys(incident.responses[200].content)).toEqual([
      'application/vnd.sanctuary.support-incident.v1+json',
    ]);
    expect(incident.responses[200].headers).toMatchObject({
      'Cache-Control': { schema: { enum: ['no-store'] } },
      'X-Content-Type-Options': { schema: { enum: ['nosniff'] } },
    });

    const capture = openApiSpec.paths['/admin/support-package/incident-capture'];
    expect(capture.get.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminIncidentCaptureStatus',
    });
    expect(capture.post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminIncidentCaptureArmRequest',
    });
    expect(capture.delete.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminIncidentCaptureTeardownRequest',
    });
    for (const method of ['get', 'post', 'delete'] as const) {
      expect(capture[method].responses[503].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/AdminIncidentCaptureUnavailableResponse',
      });
    }
  });

  it('keeps incident selectors strict and out of response state', () => {
    const request = openApiSpec.components.schemas.AdminIncidentSupportPackageRequest;
    expect(request).toMatchObject({
      required: [
        'txid', 'senderWalletId', 'receiverWalletId',
        'approximateIncidentTime', 'confirmIncidentProfile',
      ],
      additionalProperties: false,
    });
    expect(request.properties.txid.pattern).toBe('^[0-9a-fA-F]{64}$');
    expect(request.properties.confirmIncidentProfile.enum).toEqual([true]);

    const status = openApiSpec.components.schemas.AdminIncidentCaptureStatus;
    expect(status).toMatchObject({ required: ['state'], additionalProperties: false });
    expect(Object.keys(status.properties).sort()).toEqual(['expiresIn', 'failure', 'state']);
    expect(status.properties.state.enum).toEqual([
      'inactive', 'arming', 'ready', 'partial', 'invalid', 'tearing_down',
    ]);
    expect(openApiSpec.components.schemas.AdminIncidentCaptureTeardownRequest).toEqual({
      type: 'object',
      properties: {
        confirmIncidentCaptureTeardown: { type: 'boolean', enum: [true] },
      },
      required: ['confirmIncidentCaptureTeardown'],
      additionalProperties: false,
    });
  });

  it('documents strict sender and receiver categorical evidence', () => {
    const envelope = openApiSpec.components.schemas.AdminIncidentSupportPackageV1;
    expect(envelope).toMatchObject({
      required: ['version', 'profile', 'generatedAt', 'serverVersion', 'collectors', 'meta'],
      additionalProperties: false,
    });
    expect(envelope.properties.version.enum).toEqual(['1.0.0']);
    expect(envelope.properties.profile.enum).toEqual(['single_incident']);
    expect(envelope.properties.meta.properties.privacyValidation.enum).toEqual(['passed']);

    const sender = openApiSpec.components.schemas.SupportIncidentSenderEvidence;
    const receiver = openApiSpec.components.schemas.SupportIncidentReceiverEvidence;
    expect(sender.properties.role.enum).toEqual(['sender']);
    expect(sender.properties.expectedDirection.enum).toEqual(['sent']);
    expect(receiver.properties.role.enum).toEqual(['receiver']);
    expect(receiver.properties.expectedDirection.enum).toEqual(['received']);
    for (const role of [sender, receiver]) {
      expect(role).toMatchObject({
        required: [
          'role', 'expectedDirection', 'transactionRow',
          'receiverMatch', 'eligibility', 'notificationJob',
        ],
        additionalProperties: false,
      });
      expect(role.properties.notificationJob).toMatchObject({
        required: [
          'lookupStatus', 'presence', 'state', 'attempts', 'enqueue', 'handler',
          'terminal', 'telegram', 'ages', 'retention',
        ],
        additionalProperties: false,
      });
    }
  });
}

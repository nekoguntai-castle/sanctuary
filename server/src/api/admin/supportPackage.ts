/**
 * Admin Support Package Router
 *
 * Failure-atomic endpoint for the privacy-safe aggregate support profile.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { incidentDiagnosticsJsonParser } from '../../middleware/bodyParsing';
import { asyncHandler } from '../../errors/errorHandler';
import {
  generateSerializedIncidentProfile,
  generateSerializedSupportPackage,
} from '../../services/supportPackage';
import { getControlledCaptureService } from '../../services/supportPackage/captureRuntime';
import { acquireSupportPackageGenerationLease } from '../../services/supportPackage/generationLease';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('ADMIN_SUPPORT:ROUTE');

const requestSchema = z.object({
  confirmShareableAggregate: z.literal(true),
}).strict();

const incidentSelectorsSchema = z.object({
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
  senderWalletId: z.string().min(1).max(128),
  receiverWalletId: z.string().min(1).max(128),
  approximateIncidentTime: z.iso.datetime(),
}).strict().refine(
  value => value.senderWalletId !== value.receiverWalletId,
  { message: 'incident_wallets_must_be_distinct' },
);

const incidentRequestSchema = incidentSelectorsSchema.extend({
  confirmIncidentProfile: z.literal(true),
});
const captureArmRequestSchema = incidentSelectorsSchema.extend({
  confirmIncidentCapture: z.literal(true),
});
const captureTeardownRequestSchema = z.object({
  confirmIncidentCaptureTeardown: z.literal(true),
}).strict();

const SUPPORT_PACKAGE_FAILED_RESPONSE = {
  error: 'support_package_unavailable',
  message: 'The privacy-safe support package could not be generated.',
} as const;
const INCIDENT_PROFILE_FAILED_RESPONSE = {
  error: 'incident_profile_unavailable',
  message: 'The privacy-safe incident profile could not be generated.',
} as const;
const CAPTURE_FAILED_RESPONSE = {
  error: 'incident_capture_unavailable',
  message: 'The controlled incident capture service is unavailable.',
} as const;

function attachmentTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

function canonicalIncidentSelectors(body: z.infer<typeof incidentSelectorsSchema>) {
  return {
    txid: body.txid.toLowerCase(),
    senderWalletId: body.senderWalletId,
    receiverWalletId: body.receiverWalletId,
  };
}

/**
 * POST /api/v1/admin/support-package
 * Generate and send the already-validated canonical bytes.
 */
router.post(
  '/support-package',
  authenticate,
  requireAdmin,
  validate({ body: requestSchema }),
  asyncHandler(async (req, res) => {
    const lease = await acquireSupportPackageGenerationLease();
    if (lease.status === 'busy') {
      return res.status(429).json({ error: 'support_package_generation_in_progress' });
    }
    if (lease.status === 'unavailable') {
      return res.status(503).json(SUPPORT_PACKAGE_FAILED_RESPONSE);
    }
    const release = lease.release;

    try {
      const bytes = await generateSerializedSupportPackage();
      await auditService.logFromRequest(
        req,
        AuditAction.SUPPORT_PACKAGE_GENERATE,
        AuditCategory.ADMIN,
        { details: { profile: 'shareable_aggregate', version: '2.0.0' } },
      ).catch(() => log.warn('Support package audit write failed', { code: 'audit_unavailable' }));

      const timestamp = attachmentTimestamp();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="sanctuary-support-${timestamp}.json"`);
      res.setHeader('Content-Length', bytes.byteLength);
      return res.send(bytes);
    } catch {
      return res.status(503).json(SUPPORT_PACKAGE_FAILED_RESPONSE);
    } finally {
      await release().catch(() => log.warn(
        'Support package generation lease release failed',
        { code: 'lease_release_failed' },
      ));
    }
  }),
);

router.post(
  '/support-package/incident',
  authenticate,
  requireAdmin,
  incidentDiagnosticsJsonParser(),
  validate({ body: incidentRequestSchema }),
  asyncHandler(async (req, res) => {
    const lease = await acquireSupportPackageGenerationLease();
    if (lease.status === 'busy') {
      return res.status(429).json({ error: 'support_package_generation_in_progress' });
    }
    if (lease.status === 'unavailable') return res.status(503).json(INCIDENT_PROFILE_FAILED_RESPONSE);
    try {
      const selectors = canonicalIncidentSelectors(req.body);
      const capture = await getControlledCaptureService()?.read(selectors);
      const bytes = await generateSerializedIncidentProfile({
        ...selectors,
        approximateIncidentAt: new Date(req.body.approximateIncidentTime),
      }, capture);
      await auditService.logFromRequest(
        req,
        AuditAction.SUPPORT_INCIDENT_PROFILE_GENERATE,
        AuditCategory.ADMIN,
        { details: { profile: 'single_incident', version: '1.0.0' } },
      ).catch(() => log.warn('Incident profile audit write failed', { code: 'audit_unavailable' }));
      res.setHeader('Content-Type', 'application/vnd.sanctuary.support-incident.v1+json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="sanctuary-support-incident-${attachmentTimestamp()}.json"`,
      );
      res.setHeader('Content-Length', bytes.byteLength);
      return res.send(bytes);
    } catch {
      return res.status(503).json(INCIDENT_PROFILE_FAILED_RESPONSE);
    } finally {
      await lease.release().catch(() => log.warn(
        'Incident profile generation lease release failed',
        { code: 'lease_release_failed' },
      ));
    }
  }),
);

router.get(
  '/support-package/incident-capture',
  authenticate,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const capture = getControlledCaptureService();
    if (!capture) return res.status(503).json(CAPTURE_FAILED_RESPONSE);
    return res.json(await capture.status());
  }),
);

router.post(
  '/support-package/incident-capture',
  authenticate,
  requireAdmin,
  incidentDiagnosticsJsonParser(),
  validate({ body: captureArmRequestSchema }),
  asyncHandler(async (req, res) => {
    const capture = getControlledCaptureService();
    if (!capture) return res.status(503).json(CAPTURE_FAILED_RESPONSE);
    const status = await capture.arm(canonicalIncidentSelectors(req.body));
    await auditService.logFromRequest(
      req,
      AuditAction.SUPPORT_INCIDENT_CAPTURE_ARM,
      AuditCategory.ADMIN,
      { details: { profile: 'single_incident', duration: 'up_to_15_minutes' } },
    ).catch(() => log.warn('Incident capture audit write failed', { code: 'audit_unavailable' }));
    return res.status(status.state === 'invalid' ? 503 : 201).json(status);
  }),
);

router.delete(
  '/support-package/incident-capture',
  authenticate,
  requireAdmin,
  incidentDiagnosticsJsonParser(),
  validate({ body: captureTeardownRequestSchema }),
  asyncHandler(async (req, res) => {
    const capture = getControlledCaptureService();
    if (!capture) return res.status(503).json(CAPTURE_FAILED_RESPONSE);
    const status = await capture.teardown();
    await auditService.logFromRequest(
      req,
      AuditAction.SUPPORT_INCIDENT_CAPTURE_TEARDOWN,
      AuditCategory.ADMIN,
      { details: { profile: 'single_incident' } },
    ).catch(() => log.warn('Incident capture teardown audit write failed', { code: 'audit_unavailable' }));
    return res.status(status.state === 'invalid' ? 503 : 200).json(status);
  }),
);

export default router;

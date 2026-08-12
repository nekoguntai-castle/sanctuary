import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/ApiError';
import { asyncHandler } from '../errors/errorHandler';
import { authenticate } from '../middleware/auth';
import { rateLimitByUser } from '../middleware/rateLimit';
import { jadePinRelayJsonParser } from '../middleware/bodyParsing';
import { validate } from '../middleware/validate';
import { relayJadePinRequest } from '../services/jadePinRelay';

const router = Router();
const boundedJsonParser = jadePinRelayJsonParser();
const jadePinRelayLimiter = rateLimitByUser('api:default', {
  message: 'Jade PIN relay rate limit exceeded. Please wait before trying again.',
});

const JadePinRelayBodySchema = z.object({
  operation: z.enum(['get_pin', 'set_pin']),
  data: z.json(),
}).strict();

router.use(authenticate);

const parseJadePinRelayBody: RequestHandler = (req, res, next) => {
  boundedJsonParser(req, res, error => {
    if (error) {
      next(new ValidationError('Invalid Jade PIN relay request'));
      return;
    }
    next();
  });
};

router.post(
  '/jade/pin',
  jadePinRelayLimiter,
  parseJadePinRelayBody,
  validate({ body: JadePinRelayBodySchema }, { message: 'Invalid Jade PIN relay request' }),
  asyncHandler(async (req, res) => {
    const result = await relayJadePinRequest(req.body);
    res.json(result);
  }),
);

export default router;

import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limitedResponse(propertyName) {
  return (request, response) => {
    const resetTime = request[propertyName]?.resetTime?.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000) || 1);
    response.set('Retry-After', String(retryAfterSeconds));
    return response.status(429).json({
      error: 'Too many attempts. Please try again later.',
      retryAfterSeconds,
    });
  };
}

function limiter({ windowMs, max, propertyName, keyGenerator, skip, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    requestPropertyName: propertyName,
    identifier: propertyName,
    keyGenerator,
    skip,
    skipSuccessfulRequests,
    handler: limitedResponse(propertyName),
  });
}

export function createUnlockLimiters({ windowMs = FIFTEEN_MINUTES, perCardMax = 5, perIpMax = 20 } = {}) {
  // Use the connection's IP, with IPv6 subnet grouping. Express does not trust
  // forwarded headers by default, so callers cannot choose a different identity.
  const byIp = limiter({
    windowMs, max: perIpMax, propertyName: 'unlockIpLimit',
    keyGenerator: (request) => ipKeyGenerator(request.ip),
    skipSuccessfulRequests: true,
  });
  const byCard = limiter({
    windowMs, max: perCardMax, propertyName: 'unlockCardLimit',
    keyGenerator: (request) => `${ipKeyGenerator(request.ip)}:${request.params.shareToken}`,
    skipSuccessfulRequests: true,
  });
  return [byIp, byCard];
}

export function createProtectedCreationLimiter({ windowMs = FIFTEEN_MINUTES, max = 20 } = {}) {
  // Hashing is intentionally expensive. Bound that work without changing the
  // normal, unprotected creation flow; run this before hashing or database work.
  return limiter({
    windowMs, max, propertyName: 'protectedCreationLimit',
    keyGenerator: (request) => ipKeyGenerator(request.ip),
    skip: (request) => request.body?.protection?.enabled !== true,
    skipSuccessfulRequests: false,
  });
}

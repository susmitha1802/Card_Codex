import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

function limiter({ max, windowMs }) {
  return rateLimit({ limit: max, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (request) => ipKeyGenerator(request.ip),
    handler(request, response) {
      const reset = request.rateLimit?.resetTime?.getTime();
      const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000) || 1);
      response.set({ 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' });
      response.status(429).json({ error: 'Too many requests. Please try again later.', retryAfterSeconds });
    },
  });
}

// These run before parsing bodies or looking up cards. Earlier hashing, upload,
// and failed-unlock limits still protect their more expensive operations.
export function createRequestLimits({ creation = {}, reads = {}, media = {}, health = {} } = {}) {
  const create = limiter({ max: 60, windowMs: 15 * 60 * 1000, ...creation });
  const read = limiter({ max: 240, windowMs: 60 * 1000, ...reads });
  const photo = limiter({ max: 600, windowMs: 5 * 60 * 1000, ...media });
  const probe = limiter({ max: 60, windowMs: 60 * 1000, ...health });
  return (request, response, next) => {
    const path = request.path;
    if (request.method === 'POST' && /^\/api\/cards\/?$/.test(path)) return create(request, response, next);
    if (!['GET', 'HEAD'].includes(request.method)) return next();
    if (/^\/api\/health(?:\/|$)/.test(path)) return probe(request, response, next);
    if (/^\/api\/cards\/[^/]+\/media\//.test(path)) return photo(request, response, next);
    if (/^\/api\/(?:cards|share-preview)(?:\/|$)/.test(path) || /^\/card(?:\/|$)/.test(path)) return read(request, response, next);
    return next();
  };
}

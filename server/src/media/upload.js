import multer from 'multer';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { PHOTO_LIMITS } from '../../../shared/mediaOptions.js';

// Only this route accepts files. Buffering is bounded before image decoding.
export function createPhotoUploadMiddleware({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  const limitUploads = rateLimit({
    windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (request) => ipKeyGenerator(request.ip),
    skip: (request) => !request.is('multipart/form-data'),
    handler: (request, response) => {
      const reset = request.rateLimit?.resetTime?.getTime();
      const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000) || 1);
      response.set('Retry-After', String(retryAfterSeconds));
      response.status(429).json({ error: 'Too many photo uploads. Please try again later.', retryAfterSeconds });
    },
  });
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: PHOTO_LIMITS.maxFiles,
      fileSize: PHOTO_LIMITS.maxBytes,
      fields: 1,
      fieldSize: 64 * 1024,
      parts: PHOTO_LIMITS.maxFiles + 1,
      fieldNameSize: 100,
      headerPairs: 200,
    },
  }).array('photos', PHOTO_LIMITS.maxFiles);

  function parseMultipart(request, response, next) {
    if (!request.is('multipart/form-data')) return next();
    parse(request, response, (error) => {
      if (error) {
        const tooLarge = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FIELD_VALUE';
        const message = tooLarge
            ? 'Each photo must be 5 MiB or smaller, and card details must fit within 64 KiB.'
          : 'Add up to four photos and send card details in the card field.';
        return response.status(tooLarge ? 413 : 400).json({
          error: message, fields: { photos: message },
        });
      }
      if (!request.body || Object.keys(request.body).length !== 1 || typeof request.body.card !== 'string') {
        return response.status(400).json({ error: 'Send your card details in the card field.' });
      }
      try {
        request.body = JSON.parse(request.body.card);
      } catch {
        return response.status(400).json({ error: 'The card could not be read. Please try again.' });
      }
      return next();
    });
  }

  return [limitUploads, parseMultipart];
}

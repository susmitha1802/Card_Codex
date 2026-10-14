import { Router } from 'express';
import { createCardsService } from '../services/cards.js';
import { isShareToken, validateCardInput, validateUnlockInput } from '../validation/cards.js';
import { createProtectedCreationLimiter, createUnlockLimiters } from '../security/unlock-limits.js';
import { createPhotoUploadMiddleware } from '../media/upload.js';
import { createStorage, assertStorageAdapter } from '../storage/index.js';
import { createMediaGrants, readMediaGrant } from '../security/media-grants.js';

export function createCardsRouter(repository, {
  unlockLimits, creationLimit, uploadLimit,
  mediaStorage = createStorage(),
  mediaGrants = createMediaGrants(),
  secureCookies = process.env.NODE_ENV === 'production',
} = {}) {
  assertStorageAdapter(mediaStorage);
  const router = Router();
  const cards = createCardsService(repository, { mediaStorage, mediaGrants });

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/', ...createPhotoUploadMiddleware(uploadLimit), createProtectedCreationLimiter(creationLimit), async (request, response) => {
    const result = validateCardInput(request.body);
    if (!result.valid) {
      return response.status(400).json({ error: 'Please check your card details.', fields: result.fields });
    }
    try {
      return response.status(201).json(await cards.create(result.card, request.files ?? []));
    } catch (error) {
      if (error.isPhotoError && (error.status === 400 || error.status === 413)) {
        return response.status(error.status).json({ error: error.message, fields: { photos: error.message } });
      }
      return response.status(503).json({ error: 'We could not save your card right now. Please try again.' });
    }
  });

  router.get('/:shareToken', async (request, response) => {
    const notFound = () => response.status(404).json({ error: "This card couldn't be found." });
    if (!isShareToken(request.params.shareToken)) return notFound();
    try {
      const result = await cards.findPublic(request.params.shareToken, readMediaGrant(request));
      if (!result) return notFound();
      return response.json(result);
    } catch {
      return response.status(503).json({ error: 'We could not load this card right now. Please try again.' });
    }
  });

  router.get('/:shareToken/media/:mediaId', async (request, response) => {
    response.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    const notFound = () => response.status(404).json({ error: 'This photo could not be found.' });
    const { shareToken, mediaId } = request.params;
    if (!isShareToken(shareToken) || !isShareToken(mediaId)) return notFound();
    try {
      const photo = await cards.readPhoto(shareToken, mediaId, readMediaGrant(request));
      if (!photo) return notFound();
      return response.type('image/webp').send(photo);
    } catch {
      return response.status(503).json({ error: 'We could not load this photo right now. Please try again.' });
    }
  });

  router.post('/:shareToken/unlock', ...createUnlockLimiters(unlockLimits), async (request, response) => {
    const failed = () => response.status(401).json({ error: 'We could not unlock this card. Please check the code and try again.' });
    if (!isShareToken(request.params.shareToken) || !validateUnlockInput(request.body)) return failed();
    try {
      let grant;
      const result = await cards.unlock(request.params.shareToken, request.body.code, {
        onAuthorized: (codeHash) => { grant = mediaGrants.issue(request.params.shareToken, codeHash); },
      });
      if (!result) return failed();
      if (grant) {
        response.cookie('card_access', grant, {
          httpOnly: true,
          sameSite: 'strict',
          secure: secureCookies || request.secure,
          path: `/api/cards/${request.params.shareToken}`,
          maxAge: mediaGrants.ttlMs,
        });
      }
      return response.json(result);
    } catch {
      return response.status(503).json({ error: 'We could not unlock this card right now. Please try again.' });
    }
  });

  return router;
}

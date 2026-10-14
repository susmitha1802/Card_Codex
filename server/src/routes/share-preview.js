import { Router } from 'express';
import { getPreviewCopy } from '../../../shared/sharePreview.js';
import { getSharePreviewStatus } from '../sharing/preview.js';

// Crawlers receive the same generic copy whether a card is protected or public.
export function createSharePreviewRouter(repository) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', (_request, response) => response.status(404).json(getPreviewCopy(404)));
  router.get('/:shareToken', async (request, response) => {
    const status = await getSharePreviewStatus(repository, request.params.shareToken);
    response.status(status).json(getPreviewCopy(status));
  });
  router.use((error, _request, response, next) => {
    if (error instanceof URIError) return response.status(404).json(getPreviewCopy(404));
    return next(error);
  });
  return router;
}

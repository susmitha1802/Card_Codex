import express, { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isShareToken } from '../validation/cards.js';
import { getPreviewCopy, renderShareDocument } from '../../../shared/sharePreview.js';

export async function getSharePreviewStatus(repository, shareToken) {
  if (!isShareToken(shareToken)) return 404;
  try {
    // This existing query filters inactive and expired cards. Content, photos,
    // theme, title and recipient information are never needed for link previews.
    return await repository.findProtectionByToken(shareToken) ? 200 : 404;
  } catch {
    return 503;
  }
}

// Production uses the compiled Vite app. Development continues to use Vite.
// These explicit routes never serve server files or the private photo folder.
export function createBuiltFrontendRouter(repository, { directory, publicOrigin }) {
  const router = Router();
  const templatePath = resolve(directory, 'index.html');
  router.use('/assets', express.static(resolve(directory, 'assets'), {
    index: false, redirect: false, dotfiles: 'ignore', immutable: true, maxAge: '1y',
    setHeaders: (response) => response.setHeader('X-Content-Type-Options', 'nosniff'),
  }));
  router.get('/share-preview.png', (_request, response) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.sendFile(resolve(directory, 'share-preview.png'), { maxAge: '1d' }, (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: 'This image could not be found.' });
    });
  });

  router.get(['/', '/health'], async (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    try {
      response.type('html').send(await readFile(templatePath, 'utf8'));
    } catch {
      response.status(503).type('text').send('The app could not be loaded right now. Please try again.');
    }
  });

  router.get(/^\/card(?:\/.*)?$/, async (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    const match = request.path.match(/^\/card\/([A-Za-z0-9_-]{32})\/?$/);
    const shareToken = match?.[1];
    const status = await getSharePreviewStatus(repository, shareToken);
    try {
      const template = await readFile(templatePath, 'utf8');
      response.status(status).type('html').send(renderShareDocument(template, { status, shareToken, publicOrigin }));
    } catch {
      const copy = getPreviewCopy(503);
      response.status(503).type('text').send(`${copy.title} ${copy.description}`);
    }
  });
  return router;
}

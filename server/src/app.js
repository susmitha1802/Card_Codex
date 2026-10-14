import express from 'express';
import { createHealthRouter } from './routes/health.js';
import { createCardsRouter } from './routes/cards.js';
import { createSharePreviewRouter } from './routes/share-preview.js';
import { createBuiltFrontendRouter } from './sharing/preview.js';
import { createHttpSecurity } from './security/http.js';
import { createRequestLimits } from './security/request-limits.js';

export function createApp({ checkDatabase, checkStorage, cardsRepository, cardsOptions, frontend, security = {}, requestLimits, healthOptions }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', security.trustProxy ?? false);
  app.use(createHttpSecurity({ publicOrigin: frontend?.publicOrigin, ...security }));
  app.use(createRequestLimits(requestLimits));
  app.use('/api', createHealthRouter(checkDatabase, { checkStorage, ...healthOptions }));

  if (cardsRepository) {
    app.use('/api/share-preview', createSharePreviewRouter(cardsRepository));
    app.use('/api/cards', (request, response, next) => {
      const photoCreation = request.path === '/' && request.is('multipart/form-data');
      if (request.method === 'POST' && !request.is('application/json') && !photoCreation) {
        return response.status(415).json({ error: 'Send your card as JSON.' });
      }
      next();
    });
    // Routes validate the value's shape, including valid JSON null/primitives.
    app.use('/api/cards', express.json({ limit: '64kb', strict: false }), createCardsRouter(cardsRepository, {
      ...cardsOptions, ...(security.production ? { secureCookies: true } : {}),
    }));
  }

  if (frontend) app.use(createBuiltFrontendRouter(cardsRepository, frontend));

  app.use((_request, response) => {
    response.status(404).json({ error: 'Endpoint not found.' });
  });

  app.use((error, _request, response, _next) => {
    if (response.headersSent) return response.end();
    if (error instanceof URIError) return response.status(400).json({ error: 'This link could not be read.' });
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Your card is too long. Please shorten the message.' });
    }
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: 'The card could not be read. Please try again.' });
    }
    response.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

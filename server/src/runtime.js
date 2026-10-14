import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApp } from './app.js';
import { config } from './config.js';
import { checkReadyDatabase, checkSchema, client, database, runDatabaseOperation, closeDatabase } from './db.js';
import { createCardsRepository } from './repositories/cards.js';
import { createStorage } from './storage/index.js';
import { registerShutdown } from './shutdown.js';

export async function startServer({ log }) {
  let server;
  try {
    const frontendDirectory = fileURLToPath(new URL('../../client/dist/', import.meta.url));
    if (config.serveFrontend) {
      try { await access(new URL('../../client/dist/index.html', import.meta.url)); }
      catch { const error = new Error('Build the frontend before starting production.'); error.code = 'BUILD_NOT_FOUND'; throw error; }
    }
    const storage = createStorage({ driver: config.mediaDriver, directory: config.mediaDirectory });
    // Bound the image library's own cache and worker count on a small server.
    sharp.cache({ memory: 20, files: 0, items: 50 });
    sharp.concurrency(1);
    const app = createApp({
      checkDatabase: checkReadyDatabase, checkStorage: () => storage.checkAvailability(), security: config.httpSecurity,
      cardsRepository: createCardsRepository(database, client, {
        runOperation: runDatabaseOperation, operationTimeoutMS: config.database.timeoutMS,
        assertSchemaReady: checkSchema,
        onUncertainWrite: () => log('database_write_uncertain'),
      }), cardsOptions: { mediaStorage: storage },
      ...(config.serveFrontend ? { frontend: { directory: frontendDirectory, publicOrigin: config.publicAppOrigin } } : {}),
    });
    server = app.listen(config.port, config.host);
    server.requestTimeout = 120000;
    server.headersTimeout = 15000;
    server.keepAliveTimeout = 5000;
    await once(server, 'listening');
    const lifecycle = registerShutdown({ server, pool: { close: closeDatabase }, log });
    log('server_started', { mode: config.mode, port: config.port, servesFrontend: config.serveFrontend });
    // The app remains alive if a dependency is down. Readiness reports that state.
    const checks = await Promise.allSettled([checkReadyDatabase(), storage.checkAvailability()]);
    log('dependency_check', { database: checks[0].status === 'fulfilled' ? 'available' : 'unavailable',
      storage: checks[1].status === 'fulfilled' ? 'available' : 'unavailable' });
    return { app, server, shutdown: lifecycle.shutdown };
  } catch (error) {
    if (server?.listening) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    await closeDatabase().catch(() => {});
    throw error;
  }
}

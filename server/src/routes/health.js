import { Router } from 'express';

export function createHealthRouter(checkDatabase, { checkStorage, timeoutMs = 3500, cacheMs = 5000 } = {}) {
  const router = Router();
  let cached;
  let checking;

  async function check(checker) {
    if (typeof checker !== 'function') return false;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(checker),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), timeoutMs); }),
      ]);
      return result !== false && result?.available !== false;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }

  async function dependencies() {
    if (cached && cached.expires > Date.now()) return cached.result;
    if (checking) return checking;
    checking = Promise.all([check(checkDatabase), checkStorage ? check(checkStorage) : null]).then(([database, storage]) => {
      const result = { database, storage };
      cached = { result, expires: Date.now() + cacheMs };
      return result;
    }).finally(() => { checking = null; });
    return checking;
  }

  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.get('/health/live', (_request, response) => response.json({ status: 'ok', backend: { status: 'running' } }));

  router.get(['/health', '/health/ready'], async (_request, response) => {
    const { database: connected, storage } = await dependencies();
    const ready = connected && storage !== false;

    // Do not send credentials or database error details to the browser.
    response.set('Cache-Control', 'no-store');
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      backend: { status: 'running' },
      database: { status: connected ? 'connected' : 'unavailable' },
      ...(checkStorage ? { storage: { status: storage ? 'available' : 'unavailable' } } : {}),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

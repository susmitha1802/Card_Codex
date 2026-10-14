import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';

async function withApp(options, run) {
  const server = createApp({ checkDatabase: async () => {}, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((done) => { server.close(done); server.closeIdleConnections(); }); }
}

function repository() {
  const rows = new Map();
  return { rows, async insert(card, token) { rows.set(token, { ...card, recipient_name: card.recipientName,
    unlock_code_hash: card.codeHash, unlock_hints: card.hints }); },
    async findProtectionByToken(token) { return rows.get(token) ?? null; },
    async findContentByToken(token) { return rows.get(token) ?? null; },
    async findPublicByToken(token) { return rows.get(token) ?? null; },
  };
}
const minimal = { occasion: 'birthday', message: 'A little note.', theme: 'birthday' };
const post = (url, body = minimal, headers = {}) => fetch(url + '/api/cards', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('production headers restrict scripts, framing and permissions while retaining required card styles and native sharing', async () => {
  await withApp({ security: { production: true, publicOrigin: 'https://cards.example' } }, async (origin) => {
    const response = await fetch(origin + '/api/health/live');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /img-src 'self' blob: data:/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('permissions-policy').includes('web-share=(self)'));
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=15552000');
    assert.equal(response.headers.get('x-powered-by'), null);
  });
  await withApp({}, async (origin) => assert.equal((await fetch(origin + '/api/health/live')).headers.get('content-security-policy'), null));
});

test('production CORS permits only the configured origin and rejects unsafe origins before parsing or saving', async () => {
  const repo = repository();
  await withApp({ cardsRepository: repo, security: { production: true, publicOrigin: 'https://cards.example' } }, async (origin) => {
    for (const value of ['https://evil.example', 'null', 'https://cards.example.evil.example']) {
      const response = await post(origin, minimal, { Origin: value });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal(repo.rows.size, 0);
    const response = await post(origin, minimal, { Origin: 'https://cards.example' });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://cards.example');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(response.headers.get('vary').includes('Origin'));
    assert.equal((await fetch(origin + '/api/health/live')).status, 200);
  });
});

test('CORS preflight allows only supported methods and headers and never credentialed wildcard origins', async () => {
  await withApp({ security: { production: true, publicOrigin: 'https://cards.example' } }, async (origin) => {
    const headers = { Origin: 'https://cards.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
    const allowed = await fetch(origin + '/api/cards', { method: 'OPTIONS', headers });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://cards.example');
    for (const override of [{ 'Access-Control-Request-Method': 'DELETE' }, { 'Access-Control-Request-Headers': 'Authorization' }]) {
      assert.equal((await fetch(origin + '/api/cards', { method: 'OPTIONS', headers: { ...headers, ...override } })).status, 403);
    }
  });
});

test('all card creation is limited before body parsing and forwarded headers cannot bypass an untrusted connection', async () => {
  const repo = repository();
  await withApp({ cardsRepository: repo, requestLimits: { creation: { max: 1 } } }, async (origin) => {
    assert.equal((await post(origin, minimal, { 'X-Forwarded-For': '203.0.113.1' })).status, 201);
    const response = await fetch(origin + '/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.2' }, body: 'not-json' });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal(repo.rows.size, 1);
  });
});

test('only explicitly trusted proxy addresses can supply independent client identities', async () => {
  const repo = repository();
  await withApp({ cardsRepository: repo, security: { trustProxy: ['127.0.0.1/32'] }, requestLimits: { creation: { max: 1 } } }, async (origin) => {
    for (const ip of ['203.0.113.1', '203.0.113.2']) assert.equal((await post(origin, minimal, { 'X-Forwarded-For': ip })).status, 201);
    assert.equal((await post(origin, minimal, { 'X-Forwarded-For': '203.0.113.1' })).status, 429);
  });
});

test('public lookup and media limits stop repeated work and return safe retry feedback', async () => {
  const token = 'A'.repeat(32);
  const repo = repository();
  await withApp({ cardsRepository: repo, requestLimits: { reads: { max: 1 }, media: { max: 1 } } }, async (origin) => {
    assert.equal((await fetch(origin + '/api/cards/' + token)).status, 404);
    assert.equal((await fetch(origin + '/api/share-preview/' + token)).status, 429);
    const media = origin + '/api/cards/' + token + '/media/' + token;
    assert.equal((await fetch(media)).status, 404);
    assert.equal((await fetch(media)).status, 429);
  });
});

test('liveness survives dependency failures while readiness reports only safe service status', async () => {
  await withApp({ checkDatabase: async () => { throw new Error('MONGODB_URI_PRIVATE'); },
    checkStorage: async () => { throw new Error('C:/PRIVATE_STORAGE_PATH'); } }, async (origin) => {
    const live = await fetch(origin + '/api/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok', backend: { status: 'running' } });
    const ready = await fetch(origin + '/api/health/ready');
    assert.equal(ready.status, 503);
    const body = await ready.json();
    assert.equal(body.database.status, 'unavailable');
    assert.equal(body.storage.status, 'unavailable');
    assert.ok(!JSON.stringify(body).includes('PRIVATE'));
    assert.equal(ready.headers.get('cache-control'), 'no-store');
  });
});

test('readiness is bounded, cached and coalesces simultaneous dependency probes', async () => {
  let calls = 0;
  await withApp({ checkDatabase: () => { calls++; return new Promise(() => {}); },
    checkStorage: async () => ({ available: true }), healthOptions: { timeoutMs: 15 } }, async (origin) => {
    const responses = await Promise.all([fetch(origin + '/api/health'), fetch(origin + '/api/health/ready')]);
    assert.ok(responses.every((response) => response.status === 503));
    assert.equal(calls, 1);
    const body = await (await fetch(origin + '/api/health/ready')).json();
    assert.equal(calls, 1);
    assert.equal(body.storage.status, 'available');
  });
});

test('missing and false dependency checkers fail readiness safely', async () => {
  await withApp({ checkDatabase: undefined, checkStorage: async () => false }, async (origin) => {
    const response = await fetch(origin + '/api/health/ready');
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.database.status, 'unavailable');
    assert.equal(body.storage.status, 'unavailable');
  });
});

test('production unlock cookies remain HttpOnly, Secure, Strict, bounded and scoped to one public token', async () => {
  const repo = repository();
  const code = 'Our private memory!';
  await withApp({ cardsRepository: repo, security: { production: true, publicOrigin: 'https://cards.example' } }, async (origin) => {
    const created = await (await post(origin, { ...minimal, protection: { enabled: true, code } })).json();
    const response = await fetch(`${origin}/api/cards/${created.shareToken}/unlock`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=1800/);
    assert.ok(cookie.includes(`Path=/api/cards/${created.shareToken}`));
    assert.ok(!cookie.includes(code));
  });
});

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';

async function withServer(checkDatabase, run) {
  const server = createApp({ checkDatabase }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
}

test('health reports a working backend and database', async () => {
  await withServer(async () => {}, async (url) => {
    const response = await fetch(`${url}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.backend.status, 'running');
    assert.equal(body.database.status, 'connected');
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('health stays reachable without exposing database errors', async () => {
  await withServer(async () => { throw new Error('private-password-and-host'); }, async (url) => {
    const response = await fetch(`${url}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.backend.status, 'running');
    assert.equal(body.database.status, 'unavailable');
    assert.ok(!JSON.stringify(body).includes('private-password-and-host'));
  });
});

test('unknown endpoints return a JSON 404', async () => {
  await withServer(async () => {}, async (url) => {
    const response = await fetch(`${url}/api/cards`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Endpoint not found.' });
  });
});

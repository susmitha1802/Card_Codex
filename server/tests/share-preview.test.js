import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { isShareToken } from '../src/validation/cards.js';
import { getPreviewCopy, renderShareDocument } from '../../shared/sharePreview.js';
import { sharePreviewPlugin } from '../../client/server/sharePreviewPlugin.js';

const token = 'Ab7Kx92Lm_'.padEnd(32, 'Q');
const otherToken = 'Public'.padEnd(32, 'P');
const template = '<!doctype html><html><head><title>Emotale</title><meta name="description" content="Editor" /></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

async function withServer(repository, run, frontend) {
  const server = createApp({ checkDatabase: async () => {}, cardsRepository: repository, frontend }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((done) => { server.close(done); server.closeIdleConnections(); }); }
}

function privateRepository() {
  const reads = [];
  return {
    reads,
    async findProtectionByToken(value) {
      reads.push(value);
      if (value === token) return { unlock_code_hash: 'private-hash-never-publish', unlock_hints: ['private-hint'] };
      return value === otherToken ? { unlock_code_hash: null, unlock_hints: [] } : null;
    },
    async findContentByToken() { assert.fail('Link previews must not read card content.'); },
    async findPublicByToken() { assert.fail('Link previews stay generic for public cards too.'); },
    async listMediaByToken() { assert.fail('Link previews must not read photo metadata.'); },
    async findMediaByToken() { assert.fail('Link previews must not read private media.'); },
  };
}

test('public preview API returns identical generic data for protected/public cards and ignores cookies and query content', async () => {
  const repository = privateRepository();
  await withServer(repository, async (origin) => {
    for (const value of [token, otherToken]) {
      const response = await fetch(`${origin}/api/share-preview/${value}?code=never-publish&title=private-title`, { headers: { Cookie: 'card_grant=anything' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), getPreviewCopy(200));
    }
    assert.deepEqual(repository.reads, [token, otherToken]);
  });
});

test('invalid preview tokens fail before database reads; absent/deleted/expired cards use unavailable metadata', async () => {
  const repository = privateRepository();
  await withServer(repository, async (origin) => {
    for (const value of ['', '1', '<script>', token + '\n', token + '\r\n', token + 'extra']) {
      assert.equal(isShareToken(value), false);
      const response = await fetch(`${origin}/api/share-preview/${encodeURIComponent(value)}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), getPreviewCopy(404));
    }
    assert.equal(repository.reads.length, 0);
    const response = await fetch(`${origin}/api/share-preview/${'Expired'.padEnd(32, 'E')}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), getPreviewCopy(404));
    assert.equal(repository.reads.length, 1);
  });
});

test('preview availability uses the active/unexpired lock-only MongoDB query', async () => {
  const queries = [];
  const repository = createCardsRepository({ collection(name) {
    return { async findOne(filter, options) {
      queries.push({ name, filter, options });
      return null;
    } };
  } }, {});
  await withServer(repository, async (origin) => {
    assert.equal((await fetch(`${origin}/api/share-preview/${token}`)).status, 404);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].name, 'cards');
    assert.equal(queries[0].filter.share_token, token);
    assert.ok(JSON.stringify(queries[0].filter.$expr).includes('$$NOW'));
    assert.ok(JSON.stringify(queries[0].filter.$expr).includes('active'));
    assert.deepEqual(queries[0].filter.unlock_code_hash, { $type: ['string', 'null'] });
    assert.deepEqual(queries[0].options.projection, { _id: 0, unlock_code_hash: 1, unlock_hints: 1 });
  });
});

test('database failures return safe generic preview copy without internal error details', async () => {
  await withServer({ async findProtectionByToken() { throw new Error('MONGODB_URI=private; C:/private/server/path'); } }, async (origin) => {
    const response = await fetch(`${origin}/api/share-preview/${token}`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), getPreviewCopy(503));
  });
});

test('built recipient URLs deliver crawler metadata before JavaScript and trust configured origin only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'card-codex-preview-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), template);
    await writeFile(join(directory, 'assets', 'app.js'), '/* built frontend */');
    await writeFile(join(directory, 'share-preview.png'), 'fixture image');
    await writeFile(join(directory, 'private.env'), 'DO_NOT_SERVE');
    const repository = privateRepository();
    await withServer(repository, async (origin) => {
      for (const value of [token, otherToken]) {
        const response = await fetch(`${origin}/card/${value}?code=private-code`, { headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example', Cookie: 'card_grant=ignored' } });
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.ok(html.includes('<meta property="og:title" content="Someone made something for you 💌 · Emotale"'));
        assert.ok(html.includes(`content="https://cards.example/card/${value}"`));
        assert.ok(html.includes('content="https://cards.example/share-preview.png"'));
        assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
        assert.doesNotMatch(html, /private-hash|private-hint|private-code|attacker\.example|storage_key|MONGODB_URI/);
      }
      const head = await fetch(`${origin}/card/${token}`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      for (const value of ['invalid', 'Missing'.padEnd(32, 'M')]) {
        const response = await fetch(`${origin}/card/${value}`);
        assert.equal(response.status, 404);
        const html = await response.text();
        assert.ok(html.includes(getPreviewCopy(404).title));
        assert.ok(!html.includes(getPreviewCopy(200).title));
      }
      assert.equal((await fetch(`${origin}/assets/app.js`)).status, 200);
      assert.equal((await fetch(`${origin}/share-preview.png`)).status, 200);
      assert.equal((await fetch(`${origin}/health`)).status, 200);
      for (const path of ['/private.env', '/server/.env', '/storage/photos/photo.webp', '/assets/../private.env']) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 404);
        assert.ok(!(await response.text()).includes('DO_NOT_SERVE'));
      }
    }, { directory, publicOrigin: 'https://cards.example' });
    await withServer({ async findProtectionByToken() { throw new Error('private database details'); } }, async (origin) => {
      const response = await fetch(`${origin}/card/${token}`);
      assert.equal(response.status, 503);
      assert.ok((await response.text()).includes(getPreviewCopy(503).title));
    }, { directory, publicOrigin: 'https://cards.example' });
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('card-codex-preview-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('rendered metadata cannot turn invalid tokens or origins into injected HTML', () => {
  for (const value of [token + '\n', token + '\r\n', '<script>', null]) {
    const html = renderShareDocument(template, { status: 404, shareToken: value, publicOrigin: 'https://cards.example' });
    assert.ok(html.includes('https://cards.example/card/invalid'));
    assert.ok(!html.includes('<script>'));
  }
  assert.throws(() => renderShareDocument(template, { status: 200, shareToken: token, publicOrigin: 'https://user:secret@cards.example' }));
});

test('Vite metadata middleware handles malformed request targets without leaking or rejecting', async () => {
  let handler;
  sharePreviewPlugin({ apiTarget: 'http://127.0.0.1:3001', publicOrigin: 'http://127.0.0.1:5173' })
    .configureServer({ middlewares: { use(value) { handler = value; } } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = value; } };
  await handler({ url: 'http://[', method: 'GET' }, response, () => assert.fail('Malformed URL should be handled.'));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body, 'This link could not be read.');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

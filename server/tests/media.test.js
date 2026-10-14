import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { createMediaGrants } from '../src/security/media-grants.js';
import { hashSecretCode } from '../src/security/secret-codes.js';
import { createLocalStorage } from '../src/storage/local.js';
import { PHOTO_LIMITS } from '../../shared/mediaOptions.js';

const input = { occasion: 'birthday', theme: 'birthday', message: 'A lovely day, and a lovely memory.' };
const secretCode = 'Our little memory';
const sharedHash = await hashSecretCode(secretCode);
const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ef9caa' } }).png().toBuffer();
const jpeg = await sharp({ create: { width: 24, height: 36, channels: 3, background: '#98d5c7' } }).jpeg().toBuffer();

function memoryRepository() {
  const rows = new Map();
  const media = new Map();
  const reads = { content: 0, media: 0, photo: 0 };
  function available(token) {
    const row = rows.get(token);
    return row && row.status === 'active' && (!row.expires_at || row.expires_at > Date.now()) ? row : null;
  }
  return {
    rows, media, reads,
    async insert(card, token, photos = []) {
      rows.set(token, { ...card, recipient_name: card.recipientName,
        unlock_code_hash: card.codeHash, unlock_hints: card.hints, status: 'active' });
      media.set(token, photos.map((photo) => ({
        media_id: photo.mediaId, storage_key: photo.storageKey, mime_type: photo.mimeType,
        size_bytes: photo.size, width: photo.width, height: photo.height, sort_order: photo.sortOrder,
      })));
    },
    async findProtectionByToken(token) {
      const row = available(token);
      return row ? { unlock_code_hash: row.unlock_code_hash, unlock_hints: row.unlock_hints } : null;
    },
    async findPublicByToken(token) {
      reads.content += 1;
      const row = available(token);
      return row?.unlock_code_hash === null ? row : null;
    },
    async findContentByToken(token) { reads.content += 1; return available(token); },
    async listMediaByToken(token) { reads.media += 1; return available(token) ? media.get(token) ?? [] : []; },
    async findMediaByToken(token, id) {
      reads.photo += 1;
      return available(token) ? media.get(token)?.find((photo) => photo.media_id === id) ?? null : null;
    },
  };
}

async function withFixture(t, run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'card-codex-media-'));
  const baseStorage = createLocalStorage({ directory });
  const storageCalls = { writes: 0, reads: 0, removes: 0 };
  const storage = {
    async write(...args) { storageCalls.writes += 1; return baseStorage.write(...args); },
    async read(...args) { storageCalls.reads += 1; return baseStorage.read(...args); },
    async remove(...args) { storageCalls.removes += 1; return baseStorage.remove(...args); },
  };
  const repository = options.repository ?? memoryRepository();
  const app = createApp({ checkDatabase: async () => {}, cardsRepository: repository,
    cardsOptions: { mediaStorage: storage, ...options.cardsOptions } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run({ url: `http://127.0.0.1:${server.address().port}`, directory, storage,
      storageCalls, repository, baseStorage });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('card-codex-media-'));
    await rm(target, { recursive: true, force: true });
  }
}

function postJson(url, body) {
  return fetch(`${url}/api/cards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function multipart(url, files = [], card = input, extraFields = []) {
  const form = new FormData();
  form.append('card', typeof card === 'string' ? card : JSON.stringify(card));
  for (const file of files) {
    form.append(file.field ?? 'photos', new Blob([file.buffer ?? file], { type: file.type ?? 'image/png' }), file.name ?? 'memory.png');
  }
  for (const [name, value] of extraFields) form.append(name, value);
  return fetch(`${url}/api/cards`, { method: 'POST', body: form });
}

function unlock(url, token, code = secretCode) {
  return fetch(`${url}/api/cards/${token}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
}

test('plain JSON and zero-photo multipart preserve the original card response', async (t) => {
  await withFixture(t, async ({ url, storageCalls }) => {
    for (const response of [await postJson(url, input), await multipart(url)]) {
      assert.equal(response.status, 201);
      const created = await response.json();
      const loaded = await (await fetch(`${url}/api/cards/${created.shareToken}`)).json();
      assert.deepEqual(loaded.card, { ...input, title: '', recipientName: '', font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null });
      assert.equal(Object.hasOwn(loaded.card, 'photos'), false);
    }
    assert.equal(storageCalls.writes, 0);
  });
});

test('one and multiple photos are normalized, ordered, and served without storage internals', async (t) => {
  await withFixture(t, async ({ url, repository, directory }) => {
    for (const files of [[png], [png, jpeg], [png, jpeg, png, jpeg]]) {
      const response = await multipart(url, files.map((buffer, index) => ({
        buffer, type: 'text/html', name: `private-original-${index}.html`,
      })));
      assert.equal(response.status, 201);
      const { shareToken } = await response.json();
      const loaded = await (await fetch(`${url}/api/cards/${shareToken}`)).json();
      assert.equal(loaded.card.photos.length, files.length);
      assert.equal(new Set(loaded.card.photos.map((photo) => photo.id)).size, files.length);
      assert.deepEqual(loaded.card.photos.map(({ width, height }) => [width, height]), files.map((file) => file === png ? [40, 30] : [24, 36]));
      for (const photo of loaded.card.photos) {
        assert.deepEqual(Object.keys(photo).sort(), ['height', 'id', 'url', 'width']);
        assert.match(photo.id, /^[A-Za-z0-9_-]{32}$/);
        assert.equal(photo.url, `/api/cards/${shareToken}/media/${photo.id}`);
        const image = await fetch(`${url}${photo.url}`);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/webp');
        assert.equal(image.headers.get('cache-control'), 'private, no-store');
        assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
        assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
      }
      assert.ok(!JSON.stringify(loaded).includes('storage_key'));
      assert.ok(!JSON.stringify(loaded).includes('private-original'));
      assert.ok(!JSON.stringify(loaded).includes('.webp'));
      assert.deepEqual(repository.media.get(shareToken).map((photo) => photo.sort_order), files.map((_, index) => index));
    }
    assert.equal((await readdir(directory)).length, 7);
  });
});

test('unsupported, disguised, truncated, too-large, and excessive photo submissions leave no files', async (t) => {
  await withFixture(t, async ({ url, repository, storageCalls, directory }) => {
    for (const buffer of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('GIF89a'), png.subarray(0, 20)]) {
      const response = await multipart(url, [{ buffer, name: 'pretend.png', type: 'image/png' }]);
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
    }
    const oversized = await multipart(url, [Buffer.alloc(PHOTO_LIMITS.maxBytes + 1)]);
    assert.equal(oversized.status, 413);
    assert.equal((await multipart(url, [png, png, png, png, png])).status, 400);
    assert.equal((await multipart(url, [{ buffer: png, field: 'unexpected' }])).status, 400);
    assert.equal(repository.rows.size, 0);
    assert.equal(storageCalls.writes, 0);
    assert.deepEqual(await readdir(directory), []);
  });
});

test('multipart details are strictly parsed and validated before storing any image', async (t) => {
  await withFixture(t, async ({ url, repository, storageCalls }) => {
    for (const card of ['{invalid', 'null', '[]', { ...input, message: '' }, { ...input, media: ['url supplied by sender'] }]) {
      assert.equal((await multipart(url, [png], card)).status, 400);
    }
    assert.equal((await multipart(url, [png], input, [['extra', 'value']])).status, 400);
    assert.equal((await multipart(url, [png], input, [['card', JSON.stringify(input)]])).status, 400);
    assert.equal(repository.rows.size, 0);
    assert.equal(storageCalls.writes, 0);
  });
});

test('database failure removes prepared files and hides database details', async (t) => {
  const repository = { async insert() { throw Object.assign(new Error('private MongoDB URI'), { status: 400 }); } };
  await withFixture(t, async ({ url, directory, storageCalls }) => {
    const response = await multipart(url, [png, jpeg]);
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify(await response.json()).includes('private'));
    assert.equal(storageCalls.writes, 2);
    assert.equal(storageCalls.removes, 2);
    assert.deepEqual(await readdir(directory), []);
  }, { repository });
});

test('multipart uploads are rate limited before parsing while card-only JSON remains available', async (t) => {
  await withFixture(t, async ({ url, repository, storageCalls }) => {
    assert.equal((await multipart(url, [png])).status, 201);
    const limited = await multipart(url, [png]);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await postJson(url, input)).status, 201);
    assert.equal(storageCalls.writes, 1);
    assert.equal(repository.rows.size, 2);
  }, { cardsOptions: { uploadLimit: { max: 1 } } });
});

test('protected content and photo metadata stay hidden until correct unlock, with a private cookie', async (t) => {
  await withFixture(t, async ({ url, repository, storageCalls }) => {
    const created = await multipart(url, [png, jpeg], {
      ...input, stickers: [{ id: 'heart', position: 'top-left' }],
      protection: { enabled: true, code: secretCode, hints: ['Our favorite afternoon'] },
    });
    assert.equal(created.status, 201);
    const { shareToken } = await created.json();
    const photoPath = `/api/cards/${shareToken}/media/${repository.media.get(shareToken)[0].media_id}`;
    const locked = await (await fetch(`${url}/api/cards/${shareToken}`)).json();
    assert.deepEqual(locked, { protection: { enabled: true, hints: ['Our favorite afternoon'] } });
    assert.equal(repository.reads.content, 0);
    assert.equal(repository.reads.media, 0);
    assert.equal((await fetch(`${url}${photoPath}`)).status, 404);
    assert.equal(repository.reads.photo, 0);
    assert.equal(storageCalls.reads, 0);
    const wrong = await unlock(url, shareToken, 'A wrong code');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);
    const correct = await unlock(url, shareToken);
    assert.equal(correct.status, 200);
    const successful = await correct.json();
    assert.equal(successful.card.photos.length, 2);
    assert.deepEqual(successful.card.stickers, [{ id: 'heart', position: 'top-left' }]);
    const cookie = correct.headers.get('set-cookie');
    assert.match(cookie, /^card_access=[A-Za-z0-9_-]{43};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=1800/);
    assert.ok(cookie.includes(`Path=/api/cards/${shareToken};`));
    assert.ok(!cookie.includes(secretCode) && !cookie.includes('scrypt'));
    const headers = { Cookie: cookie.split(';')[0] };
    assert.equal((await fetch(`${url}${photoPath}`, { headers })).status, 200);
    assert.deepEqual(await (await fetch(`${url}/api/cards/${shareToken}`, { headers })).json(), successful);
    const withoutCookie = await (await fetch(`${url}/api/cards/${shareToken}`)).json();
    assert.deepEqual(withoutCookie, locked);
  });
});

test('media grants reject absent, invalid, duplicate, wrong-card, stale-hash, and expired cookies before storage reads', async (t) => {
  let clock = 1000;
  const grants = createMediaGrants({ ttlMs: 100, now: () => clock });
  const repository = memoryRepository();
  await withFixture(t, async ({ url, storageCalls }) => {
    const created = await (await multipart(url, [png])).json();
    const token = created.shareToken;
    repository.rows.get(token).unlock_code_hash = sharedHash;
    const photoId = repository.media.get(token)[0].media_id;
    const path = `${url}/api/cards/${token}/media/${photoId}`;
    const allowed = grants.issue(token, sharedHash);
    const otherCard = grants.issue('Z'.repeat(32), sharedHash);
    const oldHash = grants.issue(token, 'old hash');
    for (const cookie of ['', 'card_access=invalid', `card_access=${otherCard}`, `card_access=${oldHash}`, `card_access=${allowed}; card_access=${allowed}`]) {
      assert.equal((await fetch(path, { headers: { Cookie: cookie } })).status, 404);
    }
    assert.equal(storageCalls.reads, 0);
    assert.equal((await fetch(path, { headers: { Cookie: `card_access=${allowed}` } })).status, 200);
    clock += 101;
    assert.equal((await fetch(path, { headers: { Cookie: `card_access=${allowed}` } })).status, 404);
    assert.deepEqual(await (await fetch(`${url}/api/cards/${token}`, { headers: { Cookie: `card_access=${allowed}` } })).json(), { protection: { enabled: true, hints: [] } });
    assert.equal(storageCalls.reads, 1);
  }, { repository, cardsOptions: { mediaGrants: grants } });
});

test('unprotected media is still card-bound, and missing, inactive, expired or invalid media is a friendly 404', async (t) => {
  await withFixture(t, async ({ url, repository, storageCalls, baseStorage }) => {
    const first = await (await multipart(url, [png])).json();
    const second = await (await multipart(url, [jpeg])).json();
    const photo = repository.media.get(first.shareToken)[0];
    const paths = [
      `/api/cards/${second.shareToken}/media/${photo.media_id}`,
      `/api/cards/${first.shareToken}/media/${'Z'.repeat(32)}`,
      `/api/cards/invalid/media/${photo.media_id}`,
      `/api/cards/${first.shareToken}/media/invalid`,
      `/api/cards/${first.shareToken}/media/..%2Fprivate`,
    ];
    for (const path of paths) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'This photo could not be found.' });
    }
    assert.equal(storageCalls.reads, 0);
    const validPath = `${url}/api/cards/${first.shareToken}/media/${photo.media_id}`;
    await baseStorage.remove(photo.storage_key);
    assert.equal((await fetch(validPath)).status, 404);
    repository.rows.get(first.shareToken).status = 'inactive';
    assert.equal((await fetch(validPath)).status, 404);
    repository.rows.get(first.shareToken).status = 'active';
    repository.rows.get(first.shareToken).expires_at = Date.now() - 1;
    assert.equal((await fetch(validPath)).status, 404);
    assert.equal(storageCalls.reads, 1);
  });
});

test('private storage read errors are safe and retryable', async (t) => {
  await withFixture(t, async ({ url }) => {
    const created = await (await multipart(url, [png])).json();
    const { card } = await (await fetch(`${url}/api/cards/${created.shareToken}`)).json();
    const response = await fetch(`${url}${card.photos[0].url}`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'We could not load this photo right now. Please try again.' });
  }, { cardsOptions: { mediaStorage: {
    async write() {}, async remove() {}, async read() { throw new Error('private disk path'); },
  } } });
});

test('photo repository atomically embeds every photo and returns card-bound media DTOs without sessions', async () => {
  const calls = [];
  let storedCard;
  let clockReads = 0;
  const timestamp = new Date('2026-10-09T12:00:00.000Z');
  const database = { collection(name) {
    assert.equal(name, 'cards');
    return {
      async insertOne(document, options) {
        calls.push(['insertCard', document, options]);
        storedCard = document;
        return { insertedId: document._id };
      },
      aggregate(pipeline, options) {
        calls.push(['aggregate', pipeline, options]);
        const requestedId = pipeline.find((stage) => stage.$match?.['media.media_id'])?.$match['media.media_id'];
        const selected = pipeline[0].$match.share_token === storedCard.share_token
          ? storedCard.media.filter((photo) => !requestedId || photo.media_id === requestedId) : [];
        return {
          async toArray() {
            return selected.toSorted((left, right) => left.sort_order - right.sort_order)
              .map(({ media_id, width, height }) => ({ media_id, width, height }));
          },
          async next() {
            const photo = selected[0];
            return photo ? { storage_key: photo.storage_key, mime_type: photo.mime_type } : null;
          },
        };
      },
    };
  } };
  const client = { startSession() { assert.fail('Embedded-card creation needs one document insert.'); } };
  const repository = createCardsRepository(database, client, {
    assertSchemaReady: async () => {}, now: () => { clockReads += 1; return timestamp; },
  });
  const photo = { mediaId: 'P'.repeat(32), storageKey: `${'P'.repeat(32)}.webp`, mimeType: 'image/webp', size: 500, width: 40, height: 30, sortOrder: 1 };
  const firstPhoto = { ...photo, mediaId: 'Q'.repeat(32), storageKey: `${'Q'.repeat(32)}.webp`, sortOrder: 0 };
  const card = { ...input, title: null, recipientName: null, customization: {}, codeHash: null };
  const token = 'A'.repeat(32);
  await repository.insert(card, token, [photo, firstPhoto]);
  assert.deepEqual(calls.map((call) => call[0]), ['insertCard']);
  assert.equal(clockReads, 1);
  assert.equal(storedCard.created_at, timestamp);
  assert.equal(storedCard.updated_at, timestamp);
  assert.equal(storedCard.media.every((item) => item.created_at === timestamp), true);
  assert.equal(storedCard.schema_version, 1);
  assert.equal(storedCard.share_token, token);
  assert.equal(storedCard.message, card.message);
  assert.equal(storedCard.media[0].media_id, photo.mediaId);
  assert.equal(storedCard.media[0].storage_key, photo.storageKey);
  assert.equal(Object.hasOwn(storedCard.media[0], 'card_id'), false);
  assert.deepEqual(await repository.listMediaByToken(token), [
    { media_id: firstPhoto.mediaId, width: 40, height: 30 }, { media_id: photo.mediaId, width: 40, height: 30 },
  ]);
  assert.deepEqual(await repository.findMediaByToken(token, photo.mediaId), { storage_key: photo.storageKey, mime_type: 'image/webp' });
  const listPipeline = calls[1][1];
  assert.deepEqual(listPipeline.find((stage) => stage.$sort).$sort, { 'media.sort_order': 1, 'media.media_id': 1 });
  assert.deepEqual(calls[2][1].find((stage) => stage.$match?.['media.media_id']).$match, { 'media.media_id': photo.mediaId });
  assert.deepEqual(calls[2][1].at(-1), { $limit: 1 });
  assert.equal(await repository.findMediaByToken('B'.repeat(32), photo.mediaId), null);
  for (const call of calls.filter((item) => item[0] === 'aggregate')) {
    assert.ok(JSON.stringify(call[1][0].$match).includes('$$NOW'));
    assert.deepEqual(call[2].readConcern, { level: 'majority' });
    assert.ok(call[2].timeoutMS > 0);
  }
});

test('media grant storage expires entries and stays within its cap', () => {
  let clock = 0;
  const grants = createMediaGrants({ ttlMs: 100, maxGrants: 2, now: () => clock });
  const first = grants.issue('A', 'hash');
  const second = grants.issue('B', 'hash');
  const third = grants.issue('C', 'hash');
  assert.equal(grants.allows(first, 'A', 'hash'), false);
  assert.equal(grants.allows(second, 'B', 'hash'), true);
  assert.equal(grants.allows(third, 'C', 'hash'), true);
  clock = 100;
  assert.equal(grants.allows(third, 'C', 'hash'), false);
  assert.notEqual(grants.issue('C', 'hash'), third);
});

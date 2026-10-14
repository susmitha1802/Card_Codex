import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { createCardsService } from '../src/services/cards.js';
import { validateCardInput } from '../src/validation/cards.js';

const input = { occasion: 'birthday', theme: 'birthday', message: 'A private memory.' };
const token = 'A'.repeat(32);
const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#87b2d1' } }).png().toBuffer();
const file = { buffer: png };

function memoryStorage() {
  const files = new Map();
  const removed = [];
  return {
    files, removed,
    async write(key, bytes) { files.set(key, bytes); },
    async read(key) { return files.get(key); },
    async remove(key) { removed.push(key); files.delete(key); },
  };
}

function fakeDatabase({ commitBeforeError = false, failure, owner, failRead = false } = {}) {
  const calls = { inserts: [], reads: [] };
  let saved;
  return {
    calls,
    collection(name) {
      assert.equal(name, 'cards');
      return {
        async insertOne(document, options) {
          calls.inserts.push({ document, options });
          if (commitBeforeError || !failure) saved = document;
          if (failure) throw failure;
          return { insertedId: document._id };
        },
        async findOne(filter, options) {
          calls.reads.push({ filter, options });
          if (failRead) throw new Error('private Atlas server unavailable');
          if (filter._id instanceof ObjectId) return saved ? { ...saved } : null;
          return owner ?? null;
        },
      };
    },
  };
}

function repository(db, options = {}) {
  return createCardsRepository(db, {}, { assertSchemaReady: async () => {}, ...options });
}

async function withServer(repo, storage, run) {
  const server = createApp({ checkDatabase: async () => {}, cardsRepository: repo,
    cardsOptions: { mediaStorage: storage } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((done) => { server.close(done); server.closeIdleConnections(); }); }
}

function multipart(url) {
  const form = new FormData();
  form.append('card', JSON.stringify(input));
  form.append('photos', new Blob([png], { type: 'image/png' }), 'memory.png');
  return fetch(`${url}/api/cards`, { method: 'POST', body: form });
}

test('a lost acknowledgement is recovered using the exact committed document and keeps its photo', async () => {
  const db = fakeDatabase({ commitBeforeError: true, failure: new Error('private lost acknowledgement') });
  const storage = memoryStorage();
  let uncertainEvents = 0;
  let generated = 0;
  const repo = repository(db, { onUncertainWrite: () => { uncertainEvents += 1; } });
  const service = createCardsService(repo, { mediaStorage: storage,
    generateShareToken: () => { generated += 1; return token; } });
  assert.deepEqual(await service.create(validateCardInput(input).card, [file]), {
    shareToken: token, cardPath: `/card/${token}`,
  });
  assert.equal(generated, 1);
  assert.equal(db.calls.inserts.length, 1);
  assert.equal(db.calls.reads.length, 1);
  assert.equal(String(db.calls.reads[0].filter._id), String(db.calls.inserts[0].document._id));
  assert.deepEqual(db.calls.reads[0].options.readConcern, { level: 'majority' });
  assert.equal(storage.files.size, 1);
  assert.equal(storage.removed.length, 0);
  assert.equal(uncertainEvents, 0);
});

test('an unknown save outcome retains prepared photos, makes one insert, and returns a private 503 response', async () => {
  const db = fakeDatabase({ failure: new Error('private MongoDB URI and card data'), failRead: true });
  const storage = memoryStorage();
  let events = 0;
  await withServer(repository(db, { onUncertainWrite: () => { events += 1; } }), storage, async (url) => {
    const response = await multipart(url);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(body, { error: 'We could not save your card right now. Please try again.' });
    assert.equal(JSON.stringify(body).includes('private'), false);
  });
  assert.equal(db.calls.inserts.length, 1);
  assert.equal(storage.files.size, 1);
  assert.equal(storage.removed.length, 0);
  assert.equal(events, 1);
});

test('a nonmatching document with the same private ID cannot prove that this card was committed', async () => {
  const failure = new Error('lost acknowledgement');
  const db = fakeDatabase({ commitBeforeError: true, failure });
  const originalCollection = db.collection.bind(db);
  db.collection = (name) => {
    const collection = originalCollection(name);
    const originalRead = collection.findOne.bind(collection);
    collection.findOne = async (...args) => ({ ...await originalRead(...args), message: 'Different saved content.' });
    return collection;
  };
  await assert.rejects(repository(db).insert(validateCardInput(input).card, token),
    { code: 'DATABASE_WRITE_UNCERTAIN', safeToCleanupPhotos: false });
});

test('only a proven share-token owner causes a token retry; media uniqueness conflicts clean up without retries', async () => {
  for (const field of ['media.media_id', 'media.storage_key']) {
    const conflictValue = field.endsWith('storage_key') ? `${'P'.repeat(32)}.webp` : 'P'.repeat(32);
    const duplicate = Object.assign(new Error('private duplicate key'), { code: 11000,
      keyPattern: { [field]: 1 }, keyValue: { [field]: conflictValue } });
    const db = fakeDatabase({ failure: duplicate, owner: { _id: new ObjectId() } });
    const storage = memoryStorage();
    let generated = 0;
    const service = createCardsService(repository(db), { mediaStorage: storage,
      generateShareToken: () => { generated += 1; return token; } });
    await assert.rejects(service.create(validateCardInput(input).card, [file]),
      { code: 'DATABASE_WRITE_REJECTED', safeToCleanupPhotos: true });
    assert.equal(generated, 1);
    assert.equal(db.calls.inserts.length, 1);
    assert.equal(db.calls.reads.length, 2);
    assert.equal(db.calls.reads[1].filter[field], conflictValue);
    assert.equal(storage.files.size, 0);
    assert.equal(storage.removed.length, 1);
  }
});

test('an unproven duplicate error stays uncertain and cannot regenerate the token or remove files', async () => {
  for (const duplicate of [Object.assign(new Error('duplicate'), { code: 11000 }),
    Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { share_token: 1 }, keyValue: { share_token: token } })]) {
    const db = fakeDatabase({ failure: duplicate });
    const storage = memoryStorage();
    let generated = 0;
    const service = createCardsService(repository(db), { mediaStorage: storage,
      generateShareToken: () => { generated += 1; return token; } });
    await assert.rejects(service.create(validateCardInput(input).card, [file]),
      { code: 'DATABASE_WRITE_UNCERTAIN', safeToCleanupPhotos: false });
    assert.equal(generated, 1);
    assert.equal(db.calls.inserts.length, 1);
    assert.equal(storage.files.size, 1);
    assert.equal(storage.removed.length, 0);
  }
});

test('NoWritesPerformed authorizes rollback without token regeneration', async () => {
  const failure = Object.assign(new Error('operation rejected before any write'), {
    hasErrorLabel: (label) => label === 'NoWritesPerformed',
  });
  const db = fakeDatabase({ failure });
  const storage = memoryStorage();
  const service = createCardsService(repository(db), { mediaStorage: storage, generateShareToken: () => token });
  await assert.rejects(service.create(validateCardInput(input).card, [file]),
    { code: 'DATABASE_WRITE_REJECTED', safeToCleanupPhotos: true });
  assert.equal(db.calls.inserts.length, 1);
  assert.equal(storage.files.size, 0);
  assert.equal(storage.removed.length, 1);
});

test('missing schema refuses implicit collection creation before hashing or photo preparation', async () => {
  let inserts = 0;
  let metadataReads = 0;
  const db = {
    collection() { return { async insertOne() { inserts += 1; } }; },
    listCollections() { metadataReads += 1; return { async toArray() { return []; } }; },
    createCollection() { assert.fail('Runtime cannot initialize missing database collections.'); },
  };
  const repo = createCardsRepository(db, {});
  const storage = memoryStorage();
  const service = createCardsService(repo, { mediaStorage: storage });
  const card = validateCardInput(input).card;
  Object.defineProperty(card, 'protection', { get() { assert.fail('Readiness must precede secret-code hashing.'); } });
  await assert.rejects(service.create(card, [{ buffer: Buffer.from('invalid image bytes') }]), /Missing required collection/);
  assert.equal(metadataReads, 1);
  assert.equal(inserts, 0);
  assert.equal(storage.files.size, 0);
  await assert.rejects(repo.insert(validateCardInput(input).card, token),
    { code: 'DATABASE_WRITE_REJECTED', safeToCleanupPhotos: true });
  assert.equal(inserts, 0);
});

test('invalid identifiers fail before any MongoDB operation across all repository reads', async () => {
  let operations = 0;
  const repo = repository({ collection() { return {
    async findOne() { operations += 1; },
    aggregate() { operations += 1; return { async toArray() { return []; }, async next() { return null; } }; },
  }; } });
  for (const invalid of [null, undefined, '', 'invalid', 'A'.repeat(31), 'A'.repeat(33), { $ne: null }]) {
    assert.equal(await repo.findProtectionByToken(invalid), null);
    assert.equal(await repo.findContentByToken(invalid), null);
    assert.equal(await repo.findPublicByToken(invalid), null);
    assert.deepEqual(await repo.listMediaByToken(invalid), []);
    assert.equal(await repo.findMediaByToken(invalid, token), null);
    assert.equal(await repo.findMediaByToken(token, invalid), null);
  }
  assert.equal(operations, 0);
});

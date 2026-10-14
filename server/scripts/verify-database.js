import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createDatabaseChecks } from '../src/database-checks.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { createStorage } from '../src/storage/index.js';
import { readConfig } from '../src/config-reader.js';

export function readVerificationSettings(env) {
  if (env.ALLOW_MONGODB_INTEGRATION_TEST !== 'true'
    || typeof env.MONGODB_TEST_URI !== 'string' || !env.MONGODB_TEST_URI
    || typeof env.MONGODB_TEST_DB_NAME !== 'string' || !/^[A-Za-z0-9_]+_test$/.test(env.MONGODB_TEST_DB_NAME)
    || env.MONGODB_TEST_DB_NAME === env.MONGODB_DB_NAME) {
    throw new Error('Set an explicitly opted-in, separate disposable MongoDB test database ending _test.');
  }
  return readConfig({ ...env, NODE_ENV: 'test', MONGODB_URI: env.MONGODB_TEST_URI,
    MONGODB_DB_NAME: env.MONGODB_TEST_DB_NAME }).database;
}

export async function verifyDatabase(settings) {
  const { uri, databaseName, ...options } = settings;
  const client = new MongoClient(uri, options);
  const database = client.db(databaseName);
  const { checkDatabase, checkSchema } = createDatabaseChecks(database);
  const generatedTokens = new Set(); const createdMedia = new Set();
  const message = `Owned MongoDB verification ${randomUUID()} 💌\nYou're appreciated.`;
  let directory; let storage; let server;
  try {
    await client.connect(); await checkDatabase(); await checkSchema();
    directory = await mkdtemp(join(tmpdir(), 'card-codex-mongodb-test-'));
    const local = createStorage({ driver: 'local', directory });
    storage = { ...local, async write(key, bytes) { await local.write(key, bytes); createdMedia.add(key); } };
    server = createApp({ checkDatabase, checkStorage: storage.checkAvailability,
      cardsRepository: createCardsRepository(database, client),
      cardsOptions: { mediaStorage: storage, generateShareToken() {
        const token = randomBytes(24).toString('base64url'); generatedTokens.add(token); return token;
      } },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const card = { occasion: 'thank-you', message, theme: 'romantic', recipientName: "O'Connor", title: '',
      font: 'serif', fontSize: 'large', alignment: 'left', textColor: '#ABCDEF' };
    const successfulTokens = [];
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${baseUrl}/api/cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card),
      });
      assert.equal(response.status, 201);
      const created = await response.json(); successfulTokens.push(created.shareToken);
      assert.match(created.shareToken, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(created.cardPath, `/card/${created.shareToken}`);
      const row = await database.collection('cards').findOne({ share_token: created.shareToken, message });
      assert.ok(row); assert.equal(row.schema_version, 1); assert.deepEqual(row.media, []);
      assert.equal(row.title, null); assert.equal(row.message, message); assert.equal(row.status, 'active');
      assert.equal(row.recipient_name, card.recipientName); assert.ok(row.created_at instanceof Date);
      assert.deepEqual(row.customization, { font: 'serif', fontSize: 'large', alignment: 'left', textColor: '#abcdef' });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const publicResponse = await fetch(`${baseUrl}/api/cards/${created.shareToken}`);
        assert.equal(publicResponse.status, 200);
        assert.deepEqual((await publicResponse.json()).card, {
          occasion: card.occasion, message, theme: card.theme, title: '', recipientName: card.recipientName,
          font: card.font, fontSize: card.fontSize, alignment: card.alignment, textColor: '#abcdef',
        });
      }
    }
    assert.notEqual(successfulTokens[0], successfulTokens[1]);
    const code = 'A verification memory'; const stickers = [{ id: 'heart', position: 'center' }];
    const photo = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#dbb7ca' } }).png().toBuffer();
    const upload = new FormData();
    upload.append('card', JSON.stringify({ ...card, stickers, protection: { enabled: true, code } }));
    upload.append('photos', new Blob([photo], { type: 'image/png' }), 'verification.png');
    const response = await fetch(`${baseUrl}/api/cards`, { method: 'POST', body: upload });
    assert.equal(response.status, 201); const { shareToken } = await response.json();
    const row = await database.collection('cards').findOne({ share_token: shareToken, message });
    assert.ok(row); assert.equal(row.media.length, 1);
    const metadata = row.media[0]; assert.match(row.unlock_code_hash, /^scrypt\$v1\$/);
    assert.equal(metadata.mime_type, 'image/webp');
    assert.deepEqual([metadata.width, metadata.height, metadata.sort_order], [32, 24, 0]);
    assert.deepEqual(row.customization.stickers, stickers);
    const photoPath = `/api/cards/${shareToken}/media/${metadata.media_id}`;
    assert.equal((await fetch(baseUrl + photoPath)).status, 404);
    const unlocked = await fetch(`${baseUrl}/api/cards/${shareToken}/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    assert.equal(unlocked.status, 200); const cookie = unlocked.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const image = await fetch(baseUrl + photoPath, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
    const refreshed = await fetch(`${baseUrl}/api/cards/${shareToken}`, { headers: { Cookie: cookie } });
    assert.equal((await refreshed.json()).card.photos.length, 1);
    console.log('Passed: disposable MongoDB saves, embedded metadata, protected photos, stickers, authorized reads and refresh.');
  } finally {
    let cleanupFailed = false;
    const clean = async (operation) => { try { await operation(); } catch { cleanupFailed = true; } };
    if (server) await clean(() => new Promise((resolveClosed) => { server.close(resolveClosed); server.closeIdleConnections(); }));
    // A token alone never authorizes cleanup. Match this run's unpredictable
    // message marker, then require the exact observed ObjectId as well.
    for (const token of generatedTokens) await clean(async () => {
      const card = await database.collection('cards').findOne({ share_token: token, message }, { projection: { _id: 1 } });
      if (card) await database.collection('cards').deleteOne({ _id: card._id, share_token: token, message });
    });
    for (const key of createdMedia) await clean(() => storage.remove(key));
    // Remove only an empty directory created by this run; no recursive delete.
    if (directory) await clean(() => rmdir(directory));
    await clean(() => client.close());
    if (cleanupFailed) throw new Error('Owned verification resources could not all be cleaned up.');
  }
}

export async function main(env = process.env) {
  try { await verifyDatabase(readVerificationSettings(env)); }
  catch {
    console.error('MongoDB verification failed. Use explicit test credentials, a separate database ending _test, and install its schema before running.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  await main();
}

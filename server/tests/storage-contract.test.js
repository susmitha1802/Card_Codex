import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { createStorage, assertStorageAdapter } from '../src/storage/index.js';
import { createLocalStorage } from '../src/storage/local.js';
import { preparePhotos, cleanupPhotos } from '../src/media/photos.js';

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'card-codex-storage-'));
  try { await run(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('card-codex-storage-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('storage contract supports provider-neutral CRUD adapters and requires health for runtime factories', () => {
  const adapter = { async write() {}, async read() {}, async remove() {} };
  assert.equal(assertStorageAdapter(adapter), adapter);
  assert.throws(() => assertStorageAdapter(adapter, { requireHealth: true }));
  assert.throws(() => assertStorageAdapter({ write() {} }));
  assert.throws(() => createStorage({ driver: 'unimplemented-cloud' }));
  for (const directory of ['../../client/public/private', '../../client/dist/private', '../../client/public', '../../client/public/..private']) {
    assert.throws(() => createStorage({ directory: fileURLToPath(new URL(directory, import.meta.url)) }));
  }
});

test('local availability checks exercise private CRUD and leave no probe files or paths in output', async () => {
  await withDirectory(async (directory) => {
    const adapter = createStorage({ directory: join(directory, 'private') });
    assert.deepEqual(await adapter.checkAvailability(), { available: true });
    assert.deepEqual(await readdir(join(directory, 'private')), []);
  });
});

test('photo normalization and cleanup work through a custom adapter without filesystem coupling', async () => {
  const blobs = new Map();
  const adapter = assertStorageAdapter({ async write(key, bytes) { blobs.set(key, bytes); },
    async read(key) { return blobs.get(key); }, async remove(key) { blobs.delete(key); } });
  const buffer = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#afa1cd' } }).png().toBuffer();
  const photos = await preparePhotos([{ buffer }], adapter);
  assert.equal(blobs.size, 1);
  assert.equal((await sharp(await adapter.read(photos[0].storageKey)).metadata()).format, 'webp');
  await cleanupPhotos(photos, adapter);
  assert.equal(blobs.size, 0);
});

test('linked photo files cannot be read', async (context) => {
  await withDirectory(async (directory) => {
    const key = 'A'.repeat(32) + '.webp';
    const target = join(directory, 'private-data');
    await writeFile(target, 'PRIVATE_CONTENT');
    try { await symlink(target, join(directory, key), 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { context.skip('Platform does not permit creating symlink fixtures.'); return; } throw error; }
    const adapter = createLocalStorage({ directory });
    await assert.rejects(adapter.read(key));
  });
});

test('linked storage roots cannot receive writes, including Windows junctions', async (context) => {
  await withDirectory(async (directory) => {
    const linkedRoot = join(directory, 'linked');
    try { await symlink(directory, linkedRoot, 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { context.skip('Platform does not permit linked directory fixtures.'); return; } throw error; }
    await assert.rejects(createLocalStorage({ directory: linkedRoot }).write('B'.repeat(32) + '.webp', Buffer.from('bytes')));
    assert.ok(!(await readdir(directory)).includes('B'.repeat(32) + '.webp'));
  });
});

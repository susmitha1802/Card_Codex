import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { PHOTO_LIMITS } from '../../shared/mediaOptions.js';
import { cleanupPhotos, preparePhotos } from '../src/media/photos.js';
import { createLocalStorage } from '../src/storage/local.js';

function image(width = 30, height = 20) {
  return sharp({ create: { width, height, channels: 3, background: '#d87593' } });
}

function upload(buffer, originalname = 'photo.jpg', mimetype = 'image/jpeg') {
  return { buffer, size: buffer.length, originalname, mimetype };
}

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async write(key, buffer) { files.set(key, buffer); },
    async read(key) { return files.get(key); },
    async remove(key) { files.delete(key); },
  };
}

async function assertPhotoError(action, status) {
  await assert.rejects(action, error => {
    assert.equal(error.status, status);
    assert.ok(error.message.length > 0);
    assert.doesNotMatch(error.message, /libvips|ENOENT|EACCES|stack|C:\\/i);
    return true;
  });
}

test('JPEG, PNG and WebP are decoded, normalized and saved in the supplied order', async () => {
  const storage = memoryStorage();
  const inputs = await Promise.all([image().jpeg().toBuffer(), image().png().toBuffer(), image().webp().toBuffer()]);
  // Browser names and MIME types are deliberately wrong: actual bytes decide.
  const photos = await preparePhotos(inputs.map(buffer => upload(buffer, 'untrusted.exe', 'application/octet-stream')), storage);
  assert.equal(photos.length, 3);
  assert.equal(storage.files.size, 3);
  assert.equal(new Set(photos.map(photo => photo.mediaId)).size, 3);
  for (const [index, photo] of photos.entries()) {
    assert.match(photo.mediaId, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(photo.storageKey, `${photo.mediaId}.webp`);
    assert.equal(photo.sortOrder, index);
    assert.equal(photo.mimeType, 'image/webp');
    assert.equal(photo.size, storage.files.get(photo.storageKey).length);
    assert.equal(photo.width, 30);
    assert.equal(photo.height, 20);
    assert.equal((await sharp(storage.files.get(photo.storageKey)).metadata()).format, 'webp');
    assert.equal(Object.hasOwn(photo, 'originalname'), false);
    assert.equal(Object.hasOwn(photo, 'buffer'), false);
  }
});

test('photos remain optional and at most four are accepted', async () => {
  assert.deepEqual(await preparePhotos([], memoryStorage()), []);
  assert.deepEqual(await preparePhotos(undefined, memoryStorage()), []);
  await assertPhotoError(() => preparePhotos(null, memoryStorage()), 400);
  await assertPhotoError(() => preparePhotos(Array(5).fill(upload(Buffer.from('fake'))), memoryStorage()), 400);
  const png = await image().png().toBuffer();
  assert.equal((await preparePhotos(Array(4).fill(upload(png)), memoryStorage())).length, 4);
});

test('file limits use actual bytes rather than the browser-supplied size', async () => {
  const storage = memoryStorage();
  const buffer = Buffer.alloc(PHOTO_LIMITS.maxBytes + 1);
  await assertPhotoError(() => preparePhotos([{ ...upload(buffer), size: 1 }], storage), 413);
  assert.equal(storage.files.size, 0);
  await assertPhotoError(() => preparePhotos([{ size: 1, originalname: 'photo.png' }], storage), 400);
  await assertPhotoError(() => preparePhotos([upload(Buffer.alloc(0))], storage), 400);
});

test('renamed executables, SVG and GIF cannot pass as uploaded photos', async () => {
  const storage = memoryStorage();
  const gif = await image().gif().toBuffer();
  const inputs = [
    Buffer.from('MZ this is an executable'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script></svg>'),
    gif,
  ];
  for (const buffer of inputs) {
    await assertPhotoError(() => preparePhotos([upload(buffer, 'trusted.png', 'image/png')], storage), 400);
  }
  assert.equal(storage.files.size, 0);
});

test('animated WebP, GIF and PNG animation markers are rejected', async () => {
  const raw = Buffer.alloc(10 * 20 * 3, 120);
  raw.fill(220, 10 * 10 * 3);
  const webp = await sharp(raw, { raw: { width: 10, height: 20, channels: 3, pageHeight: 10 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(webp, { animated: true }).metadata()).pages, 2);
  const gif = await sharp(webp, { animated: true }).gif().toBuffer();

  const png = await image().png().toBuffer();
  // PNG's animation control chunk is rejected even if the decoder would only
  // read frame one. The header and each static image chunk remain unchanged.
  const animationChunk = Buffer.alloc(20);
  animationChunk.writeUInt32BE(8, 0);
  animationChunk.write('acTL', 4, 'ascii');
  animationChunk.writeUInt32BE(2, 8);
  const markedPng = Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)]);
  for (const buffer of [webp, gif, markedPng]) {
    await assertPhotoError(() => preparePhotos([upload(buffer)], memoryStorage()), 400);
  }
});

test('malformed and truncated images fail before any photo is written', async () => {
  const storage = memoryStorage();
  const png = await image().png().toBuffer();
  const jpeg = await image().jpeg().toBuffer();
  const webp = await image().webp().toBuffer();
  for (const buffer of [png.subarray(0, 45), jpeg.subarray(0, jpeg.length - 30), webp.subarray(0, webp.length - 15)]) {
    await assertPhotoError(() => preparePhotos([upload(png), upload(buffer)], storage), 400);
    assert.equal(storage.files.size, 0);
  }
});

test('input dimensions and pixel counts are bounded before saving', async () => {
  const storage = memoryStorage();
  const hugePixels = await image(4001, 3000).png().toBuffer();
  const hugeWidth = await image(PHOTO_LIMITS.maxDimension + 1, 1).png().toBuffer();
  for (const buffer of [hugePixels, hugeWidth]) {
    await assertPhotoError(() => preparePhotos([upload(buffer)], storage), 400);
  }
  assert.equal(storage.files.size, 0);
});

test('normalization applies camera orientation and removes identifying metadata', async () => {
  const storage = memoryStorage();
  const jpeg = await image().withExif({ IFD0: { Artist: 'Private author', Copyright: 'Private copyright' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const source = await sharp(jpeg).metadata();
  assert.equal(source.orientation, 6);
  assert.ok(source.exif);
  const [photo] = await preparePhotos([upload(jpeg)], storage);
  const result = await sharp(storage.files.get(photo.storageKey)).metadata();
  assert.equal(result.width, 20);
  assert.equal(result.height, 30);
  assert.equal(result.exif, undefined);
  assert.equal(result.icc, undefined);
  assert.equal(result.xmp, undefined);
  assert.equal(result.orientation, undefined);
  assert.equal(storage.files.get(photo.storageKey).includes(Buffer.from('Private author')), false);
});

test('large photos resize inside 2400 pixels and small photos are not enlarged', async () => {
  const storage = memoryStorage();
  const [large, small] = await preparePhotos([
    upload(await image(3000, 2000).jpeg().toBuffer()),
    upload(await image(30, 20).png().toBuffer()),
  ], storage);
  assert.equal(large.width, 2400);
  assert.equal(large.height, 1600);
  assert.equal(small.width, 30);
  assert.equal(small.height, 20);
});

test('a failed write cleans earlier photos and returns a safe error', async () => {
  const storage = memoryStorage();
  const removed = [];
  const normalWrite = storage.write;
  let writes = 0;
  storage.write = async (key, buffer) => {
    if (++writes === 2) throw new Error('EACCES C:\\private\\uploads');
    await normalWrite(key, buffer);
  };
  const normalRemove = storage.remove;
  storage.remove = async key => { removed.push(key); await normalRemove(key); };
  const png = await image().png().toBuffer();
  await assertPhotoError(() => preparePhotos([upload(png), upload(png)], storage), 503);
  assert.equal(storage.files.size, 0);
  assert.equal(removed.length, 1);
});

test('rollback attempts every removal and tolerates cleanup failures', async () => {
  const attempted = [];
  await cleanupPhotos([{ storageKey: 'first' }, { storageKey: 'second' }], {
    async remove(key) { attempted.push(key); if (key === 'first') throw new Error('Unavailable'); },
  });
  assert.deepEqual(attempted, ['first', 'second']);
});

test('local storage allows only generated keys, never overwrites, and removes safely', async t => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'card-photo-test-'));
  const expectedParent = path.resolve(os.tmpdir());
  // Verify the target before recursively deleting a temporary test directory.
  assert.equal(path.dirname(path.resolve(temporaryDirectory)), expectedParent);
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporaryDirectory)), expectedParent);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });
  const storage = createLocalStorage({ directory: path.join(temporaryDirectory, 'private-photos') });
  const key = `${randomBytes(24).toString('base64url')}.webp`;
  const contents = Buffer.from('normalized photo');
  await storage.write(key, contents);
  assert.deepEqual(await storage.read(key), contents);
  await assert.rejects(() => storage.write(key, Buffer.from('replacement')), { code: 'EEXIST' });
  assert.deepEqual(await storage.read(key), contents);
  for (const invalid of ['../outside.webp', '..\\outside.webp', 'C:\\outside.webp', '/outside.webp', 'short.webp', `${key}.exe`, `${key}\n`, '', null]) {
    await assert.rejects(() => storage.write(invalid, contents), /Invalid photo storage key/);
    await assert.rejects(() => storage.read(invalid), /Invalid photo storage key/);
    await assert.rejects(() => storage.remove(invalid), /Invalid photo storage key/);
  }
  assert.equal((await readdir(path.join(temporaryDirectory, 'private-photos'))).length, 1);
  await storage.remove(key);
  await storage.remove(key); // Cleanup is safe to repeat.
  await assert.rejects(() => storage.read(key), { code: 'ENOENT' });
});

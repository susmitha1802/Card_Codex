import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { ensureMongoSchema } from '../scripts/migration-runner.js';
import { createDatabaseChecks } from '../src/database-checks.js';
import { schemaMigrationId } from '../src/card-schema.js';
import { createCardsRepository } from '../src/repositories/cards.js';

const uri = process.env.MONGODB_TEST_URI;
const databaseName = process.env.MONGODB_TEST_DB_NAME;
const enabled = Boolean(uri && databaseName && process.env.ALLOW_MONGODB_INTEGRATION_TEST === 'true');
const skipReason = 'Real MongoDB tests need MONGODB_TEST_URI, MONGODB_TEST_DB_NAME ending _test, and ALLOW_MONGODB_INTEGRATION_TEST=true. Runtime database credentials are never used.';

// Each run owns newly named collections within the explicitly designated test
// database. Cleanup deletes only this run's recorded document identifiers; it
// never drops a database or touches an existing application's collections.
function isolatedDatabase(database, prefix) {
  const names = ['cards', 'schema_migrations', 'card_media'];
  const physical = (name) => `${prefix}_${name}`;
  return {
    collection: (name) => database.collection(physical(name)),
    createCollection: (name, options) => database.createCollection(physical(name), options),
    command: (command, options) => database.command(command.collMod ? { ...command, collMod: physical(command.collMod) } : command, options),
    listCollections(filter = {}, options) {
      const targets = typeof filter.name === 'string' ? [filter.name] : filter.name?.$in ?? names;
      const allowedNames = new Set(targets.map(physical));
      // Preserve test isolation without Atlas-incompatible operator filters.
      const cursor = database.listCollections(typeof filter.name === 'string' ? { name: physical(filter.name) } : {}, options);
      return { async toArray() {
        return (await cursor.toArray()).filter((metadata) => allowedNames.has(metadata.name))
          .map((metadata) => ({ ...metadata, name: metadata.name.slice(prefix.length + 1) }));
      } };
    },
  };
}

test('real MongoDB embedded constraints, binary indexes and readiness', { skip: enabled ? false : skipReason }, async (suite) => {
  assert.match(databaseName, /^[A-Za-z0-9_-]+_test$/, 'Use an explicitly named test database ending _test.');
  assert.match(uri, /^mongodb(?:\+srv)?:\/\//, 'Use an explicit MongoDB test URI.');
  const client = new MongoClient(uri, {
    maxPoolSize: 2, minPoolSize: 0, serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000, timeoutMS: 5000, retryWrites: true,
  });
  const db = isolatedDatabase(client.db(databaseName), `cc_integration_${randomBytes(8).toString('hex')}`);
  const ownedIds = [];
  const randomId = () => randomBytes(16).toString('hex');
  function photo(overrides = {}) {
    const id = randomId();
    return { media_id: id, storage_key: `${id}.webp`, mime_type: 'image/webp',
      size_bytes: 1024, width: 480, height: 320, sort_order: 0, created_at: new Date(), ...overrides };
  }
  function card(overrides = {}) {
    const document = { _id: new ObjectId(), schema_version: 1, share_token: randomId(), occasion: 'birthday',
      title: null, message: 'Integration test card', recipient_name: null, theme: 'birthday',
      customization: { font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null },
      unlock_code_hash: null, unlock_hints: null, status: 'active', created_at: new Date(), updated_at: new Date(),
      expires_at: null, media: [], ...overrides };
    ownedIds.push(document._id);
    return document;
  }
  const insert = (document) => db.collection('cards').insertOne(document, { writeConcern: { w: 'majority' }, timeoutMS: 5000 });
  const invalid = (document) => assert.rejects(insert(document), (error) => error.code === 121);
  try {
    await client.connect();
    // Exercise the raw collMod command against an owned empty collection too.
    await db.createCollection('cards');
    await ensureMongoSchema(db);
    await suite.test('zero-photo cards coexist and media metadata is embedded atomically', async () => {
      await insert(card());
      await insert(card());
      const document = card({ media: [photo(), photo({ sort_order: 1 })] });
      await insert(document);
      const stored = await db.collection('cards').findOne({ _id: document._id });
      assert.equal(stored.media.length, 2);
      assert.equal(stored.media[1].sort_order, 1);
      assert.equal((await db.listCollections({ name: 'card_media' }).toArray()).length, 0);
    });
    await suite.test('per-document photo IDs, keys and order are independently unique', async () => {
      const first = photo();
      await invalid(card({ media: [first, photo({ media_id: first.media_id, sort_order: 1 })] }));
      await invalid(card({ media: [first, photo({ storage_key: first.storage_key, sort_order: 1 })] }));
      await invalid(card({ media: [first, photo()] }));
      await invalid(card({ media: Array.from({ length: 5 }, (_, index) => photo({ sort_order: index })) }));
    });
    await suite.test('cross-card photo IDs, storage keys and tokens are unique', async () => {
      const first = photo();
      const original = card({ media: [first] });
      await insert(original);
      await assert.rejects(insert(card({ media: [photo({ media_id: first.media_id })] })), (error) => error.code === 11000);
      await assert.rejects(insert(card({ media: [photo({ storage_key: first.storage_key })] })), (error) => error.code === 11000);
      await assert.rejects(insert(card({ share_token: original.share_token })), (error) => error.code === 11000);
    });
    await suite.test('tokens and photo identifiers compare with binary case sensitivity', async () => {
      const upper = 'A'.repeat(32); const lower = 'a'.repeat(32);
      await insert(card({ share_token: upper, media: [photo({ media_id: upper, storage_key: `${upper}.webp` })] }));
      await insert(card({ share_token: lower, media: [photo({ media_id: lower, storage_key: `${lower}.webp` })] }));
      assert.equal((await db.collection('cards').findOne({ share_token: upper })).share_token, upper);
      assert.equal((await db.collection('cards').findOne({ share_token: lower })).share_token, lower);
    });
    await suite.test('plaintext codes, extra roots and child fields, and arbitrary new appearance are rejected', async () => {
      await invalid(card({ code: 'plaintext-code' }));
      await invalid(card({ unlock_code_hash: 'plaintext-code' }));
      await invalid(card({ share_token: 'A'.repeat(32) + '\n' }));
      await invalid(card({ unlock_code_hash: `scrypt$v1$65536$8$2$${'a'.repeat(32)}$${'b'.repeat(128)}\n` }));
      await invalid(card({ media: [photo({ storage_key: `${'A'.repeat(32)}.webp\n` })] }));
      await invalid(card({ customization: { font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null, url: 'https://example.invalid' } }));
      await invalid(card({ media: [photo({ url: 'https://example.invalid' })] }));
      await invalid(card({ legacy_mongodb_imported: false }));
      await invalid(card({ media: [photo({ legacy_mongodb_id: new ObjectId().toHexString() })] }));
      const missingHash = card(); delete missingHash.unlock_code_hash; await invalid(missingHash);
      const missingMedia = card(); delete missingMedia.media; await invalid(missingMedia);
    });
    await suite.test('legacy values and unsigned source integers are retained without relaxing new writes', async () => {
      const imported = card({ legacy_mysql_id: '18446744073709551615', legacy_mysql_status_value: 'ACTIVE ',
        legacy_mysql_status_active: true, status: 'ACTIVE ', customization: ['legacy', { unknown: true }],
        unlock_hints: 42, unlock_code_hash: 'malformed-legacy-hash',
        media: [photo({ size_bytes: 4294967295, width: 4294967295, sort_order: 255,
          legacy_mysql_id: '18446744073709551614', legacy_mysql_card_id: '18446744073709551615' })] });
      await insert(imported);
      const stored = await db.collection('cards').findOne({ _id: imported._id });
      assert.deepEqual(stored.customization, imported.customization);
      assert.equal(stored.media[0].size_bytes, 4294967295);
      await assert.rejects(insert(card({ ...imported, _id: new ObjectId(), share_token: randomId(), media: [] })), (error) => error.code === 11000);
      const referenced = card({ legacy_mongodb_imported: true, customization: { obsolete: true },
        unlock_hints: { broken: true }, unlock_code_hash: 'legacy-damaged-hash',
        media: [photo({ legacy_mongodb_id: new ObjectId().toHexString(), legacy_mongodb_card_id: new ObjectId().toHexString() })] });
      await insert(referenced);
      assert.equal((await db.collection('cards').findOne({ _id: referenced._id })).legacy_mongodb_imported, true);
    });
    await suite.test('metadata readiness accepts effective simple collation and no TTL indexes exist', async () => {
      await createDatabaseChecks(db).checkReadyDatabase();
      const indexes = await db.collection('cards').listIndexes().toArray();
      assert.ok(indexes.every((index) => index.expireAfterSeconds === undefined));
      assert.ok(indexes.filter((index) => index.name !== '_id_').every((index) => index.unique));
      await ensureMongoSchema(db);
    });
    await suite.test('repository uses server time, redacts metadata and binds each photo to its card', async () => {
      const later = photo({ sort_order: 1 }); const first = photo({ sort_order: 0 });
      const visible = card({ expires_at: new Date(Date.now() + 60000), media: [later, first] });
      await insert(visible);
      const repo = createCardsRepository(db, client, { now: () => new Date('2099-01-01') });
      assert.ok(await repo.findPublicByToken(visible.share_token), 'An incorrect app clock cannot expire a still-active card.');
      const listed = await repo.listMediaByToken(visible.share_token);
      assert.deepEqual(listed.map((item) => item.media_id), [first.media_id, later.media_id]);
      assert.ok(listed.every((item) => Object.keys(item).sort().join(',') === 'height,media_id,width'));
      assert.deepEqual(await repo.findMediaByToken(visible.share_token, first.media_id),
        { storage_key: first.storage_key, mime_type: 'image/webp' });
      const unrelated = card(); await insert(unrelated);
      assert.equal(await repo.findMediaByToken(unrelated.share_token, first.media_id), null);
      const expired = card({ expires_at: new Date(Date.now() - 1000) }); await insert(expired);
      assert.equal(await repo.findProtectionByToken(expired.share_token), null);
      assert.equal(await repo.findPublicByToken(expired.share_token), null);
      const protectedCard = card({ message: 'PRIVATE_CARD_MESSAGE', unlock_hints: ['Public hint'],
        unlock_code_hash: `scrypt$v1$65536$8$2$${'a'.repeat(32)}$${'b'.repeat(128)}` });
      await insert(protectedCard);
      assert.equal(await repo.findPublicByToken(protectedCard.share_token), null);
      assert.deepEqual(await repo.findProtectionByToken(protectedCard.share_token),
        { unlock_code_hash: protectedCard.unlock_code_hash, unlock_hints: ['Public hint'] });
      assert.ok(!JSON.stringify(await repo.findContentByToken(protectedCard.share_token)).includes(protectedCard.unlock_code_hash));
    });
    await suite.test('legacy SQL status visibility is retained and corrupted protection cannot become public', async () => {
      const repo = createCardsRepository(db, client);
      const imported = card({ legacy_mysql_id: '42', status: 'ACTIVE ',
        legacy_mysql_status_value: 'ACTIVE ', legacy_mysql_status_active: true });
      await insert(imported);
      assert.ok(await repo.findPublicByToken(imported.share_token));
      await db.collection('cards').updateOne({ _id: imported._id }, { $set: { status: 'inactive' } });
      assert.equal(await repo.findPublicByToken(imported.share_token), null);
      const corrupted = card(); delete corrupted.unlock_code_hash;
      await db.collection('cards').insertOne(corrupted, { bypassDocumentValidation: true });
      assert.equal(await repo.findProtectionByToken(corrupted.share_token), null);
      assert.equal(await repo.findPublicByToken(corrupted.share_token), null);
      for (const hash of [[null], [null, 'private-hash'], {}, false]) {
        const wrongType = card({ unlock_code_hash: hash });
        await db.collection('cards').insertOne(wrongType, { bypassDocumentValidation: true });
        assert.equal(await repo.findProtectionByToken(wrongType.share_token), null);
        assert.equal(await repo.findPublicByToken(wrongType.share_token), null);
        assert.equal(await repo.findContentByToken(wrongType.share_token), null);
      }
      const referenced = card(); delete referenced.schema_version; delete referenced.media;
      await db.collection('cards').insertOne(referenced, { bypassDocumentValidation: true });
      assert.equal(await repo.findContentByToken(referenced.share_token), null);
    });
  } finally {
    try {
      if (ownedIds.length) await db.collection('cards').deleteMany({ _id: { $in: ownedIds } }, { timeoutMS: 5000 });
      await db.collection('schema_migrations').deleteMany({ _id: { $in: ['__mongo_schema_lease', schemaMigrationId] } }, { timeoutMS: 5000 });
    } finally { await client.close(); }
  }
});

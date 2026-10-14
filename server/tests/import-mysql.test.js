import assert from 'node:assert/strict';
import test from 'node:test';
import { BSON, ObjectId } from 'mongodb';
import { importMysql, readImportSettings, createMysqlSource } from '../scripts/import-mysql.js';
import { mapReferencedCard, readReferencedSettings, importReferenced } from '../scripts/import-referenced.js';
import { decimalId, parseMysqlDate, parseMysqlJson, mapMysqlCard, inspectCardConflict } from '../scripts/mysql-import-utils.js';
import { readVerificationSettings } from '../scripts/verify-database.js';

const clone = (value) => BSON.deserialize(BSON.serialize(value));
const date = '2026-01-02 03:04:05';
function row(id = '9007199254740993', token = 'a'.repeat(32)) {
  return { id, share_token: token, occasion: 'birthday', title: null, message: "A secret, you're appreciated",
    recipient_name: null, theme: 'romantic', customization: '{"font":"theme","fontSize":"medium","alignment":"center","textColor":null}',
    unlock_code_hash: 'existing hash unchanged', unlock_hints: '["unchanged hint"]', status: 'ACTIVE ', status_active: 1,
    created_at: date, updated_at: date, expires_at: null };
}
function photo(cardId = '9007199254740993', id = '9007199254740994', token = 'p'.repeat(32)) {
  return { id, card_id: cardId, media_id: token, storage_key: `${token}.webp`, mime_type: 'image/webp',
    size_bytes: 100, width: 20, height: 10, sort_order: 0, created_at: date };
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((part) => matches(document, part));
    if (key.startsWith('media.')) return document.media?.some((item) => item[key.slice(6)] === expected);
    const actual = document[key];
    if (expected instanceof ObjectId) return actual instanceof ObjectId && actual.equals(expected);
    if (expected && typeof expected === 'object') {
      if ('$gt' in expected) return actual > expected.$gt;
      if ('$in' in expected) return expected.$in.some((value) => actual instanceof ObjectId && actual.equals(value));
    }
    return actual === expected;
  });
}

function fakeDatabase(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, docs]) => [name, docs.map(clone)]));
  const calls = [];
  const database = {
    calls, stores, failAfterInserts: null,
    listCollections() { return { async toArray() { return [...stores.keys()].map((name) => ({ name })); } }; },
    collection(name) {
      const documents = stores.get(name) ?? [];
      const addStore = () => stores.set(name, documents);
      return {
        find(filter = {}) {
          let result = documents.filter((doc) => matches(doc, filter));
          const cursor = {
            sort(fields) { const key = Object.keys(fields)[0]; result.sort((a, b) => a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0); return cursor; },
            limit(limit) { result = result.slice(0, limit); return cursor; },
            async toArray() { return result.map(clone); },
          };
          return cursor;
        },
        async findOne(filter) { return documents.find((doc) => matches(doc, filter)) ? clone(documents.find((doc) => matches(doc, filter))) : null; },
        async countDocuments(filter = {}) { return documents.filter((doc) => matches(doc, filter)).length; },
        async insertOne(document) { calls.push(['insertOne', name]); addStore(); documents.push(clone(document)); },
        async insertMany(batch) {
          calls.push(['insertMany', name]); addStore();
          for (const document of batch) {
            if (database.failAfterInserts === 0) throw new Error('uncertain write');
            documents.push(clone(document));
            if (database.failAfterInserts !== null) database.failAfterInserts -= 1;
          }
        },
        async updateOne(filter, update) {
          calls.push(['updateOne', name]);
          const actual = documents.find((doc) => matches(doc, filter));
          if (!actual) return { matchedCount: 0 };
          Object.assign(actual, clone(update.$set)); return { matchedCount: 1 };
        },
      };
    },
  };
  return database;
}

function fakeSource(rows = [row()], photos = [photo()]) {
  return {
    rows, photos, reads: [],
    async begin() {}, async history() { return [{ name: '001_create_cards.sql', checksum: 'original', applied_at: new Date(`${date.replace(' ', 'T')}Z`) }]; },
    async counts() { return { cards: rows.length, media: photos.length }; },
    async cardsAfter(id, size) { this.reads.push(id); return rows.filter((card) => BigInt(card.id) > BigInt(id ?? '0')).slice(0, size); },
    async mediaFor(ids) { return photos.filter((media) => ids.includes(media.card_id)); },
  };
}

const connectionEnv = { MYSQL_SOURCE_HOST: 'localhost', MYSQL_SOURCE_USER: 'source_reader', MYSQL_SOURCE_PASSWORD: '',
  MYSQL_SOURCE_DB_NAME: 'source', MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DB_NAME: 'cards_staging' };
const applyEnv = { ...connectionEnv, ALLOW_MYSQL_IMPORT: 'true', MYSQL_SOURCE_WRITE_FROZEN: 'true',
  MYSQL_IMPORT_BACKUPS_CONFIRMED: 'true', MONGODB_IMPORT_TARGET_STAGING: 'true' };

test('BIGINT identity, exact UTC timestamps, JSON string/scalar/null are preserved', () => {
  assert.equal(decimalId('18446744073709551615'), '18446744073709551615');
  assert.throws(() => decimalId(9007199254740993));
  assert.throws(() => decimalId('18446744073709551616'));
  assert.equal(parseMysqlJson('"{\\"font\\":\\"theme\\"}"'), '{"font":"theme"}');
  assert.equal(parseMysqlJson('true'), true);
  assert.equal(parseMysqlJson('null'), null);
  assert.equal(parseMysqlJson(null), null);
  assert.deepEqual(parseMysqlJson('{"number":1.25e2,"text":"9007199254740993"}'), { number: 125, text: '9007199254740993' });
  assert.throws(() => parseMysqlJson('{"number":9007199254740993}'));
  assert.throws(() => parseMysqlJson('1.234567890123456789'));
  assert.throws(() => parseMysqlJson('1e999'));
  assert.equal(parseMysqlDate(date).toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(parseMysqlDate(`${date}.123000`).toISOString(), '2026-01-02T03:04:05.123Z');
  assert.throws(() => parseMysqlDate(`${date}.123001`));
  assert.throws(() => parseMysqlDate('2026-02-31 00:00:00'));
  assert.throws(() => parseMysqlDate('0000-00-00 00:00:00'));
});

test('complete mapper preserves SQL fields, status collation result, IDs and ordered media', () => {
  const document = mapMysqlCard(row(), [photo()]);
  assert.equal(document.legacy_mysql_id, '9007199254740993');
  assert.equal(document.status, 'ACTIVE ');
  assert.equal(document.legacy_mysql_status_value, 'ACTIVE ');
  assert.equal(document.legacy_mysql_status_active, true);
  assert.equal(document.unlock_code_hash, row().unlock_code_hash);
  assert.deepEqual(document.unlock_hints, ['unchanged hint']);
  assert.equal(document.media[0].legacy_mysql_id, '9007199254740994');
  assert.equal(document.media[0].legacy_mysql_card_id, document.legacy_mysql_id);
  assert.equal(document.media[0].storage_key, photo().storage_key);
  assert.ok(document._id instanceof ObjectId);
});

test('unsupported tokens, excess photos, duplicate order and mismatched parents stop without truncation', () => {
  assert.throws(() => mapMysqlCard(row('1', 'old token'), []));
  assert.throws(() => mapMysqlCard(row(), Array(5).fill(photo())));
  assert.throws(() => mapMysqlCard(row(), [photo(), photo(undefined, '2', 'q'.repeat(32))]));
  assert.throws(() => mapMysqlCard(row(), [photo('2')]));
});

test('dry-run has no permission gates and performs zero target writes, including checkpoints/schema', async () => {
  assert.equal(readImportSettings(connectionEnv).apply, false);
  const database = fakeDatabase();
  const result = await importMysql({ source: fakeSource(), database, sourceId: 'source' });
  assert.deepEqual(result, { cards: 1, media: 1, inserted: 0, matching: 0 });
  assert.deepEqual(database.calls, []);
  assert.equal(database.stores.size, 0);
});

test('apply requires frozen source, backup acknowledgment and explicit staging, and config reads BIGINT/JSON/date losslessly', () => {
  assert.throws(() => readImportSettings(connectionEnv, ['--apply']));
  for (const name of ['ALLOW_MYSQL_IMPORT', 'MYSQL_SOURCE_WRITE_FROZEN', 'MYSQL_IMPORT_BACKUPS_CONFIRMED', 'MONGODB_IMPORT_TARGET_STAGING']) {
    assert.throws(() => readImportSettings({ ...applyEnv, [name]: 'false' }, ['--apply']));
  }
  assert.throws(() => readImportSettings({ ...applyEnv, MONGODB_DB_NAME: 'production' }, ['--apply']));
  const settings = readImportSettings(applyEnv, ['--apply']);
  assert.equal(settings.source.supportBigNumbers, true);
  assert.equal(settings.source.bigNumberStrings, true);
  assert.equal(settings.source.jsonStrings, true);
  assert.equal(settings.source.dateStrings, true);
  assert.equal(settings.source.timezone, 'Z');
  assert.deepEqual(readImportSettings({ ...connectionEnv, MYSQL_SOURCE_SSL: 'true' }).source.ssl,
    { rejectUnauthorized: true, verifyIdentity: true });
  assert.throws(() => readImportSettings({ ...connectionEnv, NODE_ENV: 'production', MYSQL_SOURCE_HOST: 'remote.example' }));
});

test('source reader uses a read-only consistent UTC snapshot and string keyset paging', async () => {
  const calls = [];
  const source = createMysqlSource({ async query(...args) { calls.push(args); return [[]]; }, async execute(...args) { calls.push(args); return [[]]; } });
  await source.begin(); await source.cardsAfter('9007199254740993', 20);
  await source.mediaFor(['9007199254740993']);
  assert.equal(calls[0][0], "SET time_zone = '+00:00'");
  assert.ok(calls.some(([sql]) => sql === 'SET TRANSACTION READ ONLY'));
  assert.ok(calls.some(([sql]) => sql === 'START TRANSACTION WITH CONSISTENT SNAPSHOT'));
  const query = calls.find(([sql]) => sql.includes('FROM cards WHERE'));
  assert.match(query[0], /status = 'active'/);
  assert.match(query[0], /WHERE id > \?/);
  assert.doesNotMatch(query[0], /OFFSET/);
  assert.deepEqual(query[1], ['9007199254740993', 20]);
  assert.match(calls.at(-1)[0], /SELECT id, media_id/);
});

test('apply inserts complete embedded cards and preserved source history, then resumes without updates to cards', async () => {
  const database = fakeDatabase(); const source = fakeSource();
  const args = { source, database, sourceId: 'source', apply: true, emptyAcknowledged: true };
  assert.equal((await importMysql(args)).inserted, 1);
  const document = database.stores.get('cards')[0];
  assert.equal(document.media.length, 1);
  assert.equal(document.media[0].storage_key, photo().storage_key);
  const checkpoint = database.stores.get('schema_migrations')[0];
  assert.equal(checkpoint.last_id, row().id);
  assert.equal(checkpoint.state, 'complete');
  assert.equal(checkpoint.source_schema_history[0].checksum, 'original');
  assert.equal((await importMysql(args)).inserted, 0);
  assert.equal(database.stores.get('cards').length, 1);
  assert.ok(database.calls.filter(([type, collection]) => collection === 'cards').every(([type]) => type === 'insertMany'));
});

test('ordered-batch partial commit leaves checkpoint unchanged and resumes by exact field comparison', async () => {
  const database = fakeDatabase();
  const source = fakeSource([row('1'), row('2', 'b'.repeat(32))], [photo('1', '10')]);
  const args = { source, database, sourceId: 'source', apply: true, emptyAcknowledged: true };
  database.failAfterInserts = 1;
  await assert.rejects(importMysql(args));
  assert.equal(database.stores.get('cards').length, 1);
  assert.equal(database.stores.get('schema_migrations')[0].last_id, null);
  database.failAfterInserts = null;
  assert.equal((await importMysql(args)).inserted, 1);
  assert.equal(database.stores.get('cards').length, 2);
  assert.equal(database.stores.get('schema_migrations')[0].card_count, 2);
});

test('matching token in an unrelated target is rejected without target writes', async () => {
  const database = fakeDatabase({ cards: [mapMysqlCard(row(), [photo()])] });
  await assert.rejects(importMysql({ source: fakeSource(), database, sourceId: 'source', apply: true, emptyAcknowledged: true }));
  assert.deepEqual(database.calls, []);
});

test('changed source content conflicts during resume and never overwrites a card', async () => {
  const database = fakeDatabase(); const source = fakeSource();
  const args = { source, database, sourceId: 'source', apply: true, emptyAcknowledged: true };
  await importMysql(args); const before = clone(database.stores.get('cards')[0]);
  source.rows[0].message = 'changed';
  await assert.rejects(importMysql(args), { code: 'IMPORT_CONFLICT' });
  assert.deepEqual(database.stores.get('cards')[0], before);
});

test('existing referenced target metadata refuses a destructive conversion', async () => {
  const database = fakeDatabase({ card_media: [{ _id: new ObjectId(), media_id: 'existing' }] });
  await assert.rejects(importMysql({ source: fakeSource(), database, sourceId: 'source' }), { code: 'IMPORT_TARGET' });
  assert.deepEqual(database.calls, []);
});

test('invalid photo in a batch cannot leave a partial card or any photo metadata', async () => {
  const database = fakeDatabase(); const source = fakeSource([row()], [photo(), photo(undefined, '2', 'q'.repeat(32))]);
  await assert.rejects(importMysql({ source, database, sourceId: 'source', apply: true, emptyAcknowledged: true }));
  assert.equal(database.stores.get('cards')?.length ?? 0, 0);
  assert.equal(database.stores.has('card_media'), false);
});

function referencedFixture() {
  const parent = mapMysqlCard({ ...row('1'), status: 'active', unlock_code_hash: null, unlock_hints: null }, []);
  delete parent.schema_version; delete parent.media;
  delete parent.legacy_mysql_id; delete parent.legacy_mysql_status_value; delete parent.legacy_mysql_status_active;
  return { parent, metadata: { ...photo('1'), _id: new ObjectId(), card_id: parent._id, created_at: parseMysqlDate(date) } };
}

test('referenced mapper preserves card ObjectId, share token and private media keys', () => {
  const { parent, metadata } = referencedFixture(); delete metadata.id;
  const document = mapReferencedCard(parent, [metadata]);
  assert.equal(document._id, parent._id);
  assert.equal(document.media[0].storage_key, metadata.storage_key);
  assert.equal(Object.hasOwn(document.media[0], 'card_id'), false);
  assert.equal(Object.hasOwn(document.media[0], '_id'), false);
  assert.equal(document.media[0].legacy_mongodb_id, metadata._id.toHexString());
  assert.equal(document.media[0].legacy_mongodb_card_id, parent._id.toHexString());
  assert.equal(document.legacy_mongodb_imported, true);
});

test('referenced dry-run detects incompatible full document types and preserves optional defaults', () => {
  const { parent } = referencedFixture();
  for (const change of [{ unlock_code_hash: undefined }, { status: 1 }, { message: undefined },
    { customization: new Date() }, { unlock_hints: new Date() }, { title: 42 },
    { share_token: 'a'.repeat(32) + '\n' }]) assert.throws(() => mapReferencedCard({ ...parent, ...change }, []));
  const optional = { ...parent }; delete optional.title; delete optional.recipient_name; delete optional.customization;
  const mapped = mapReferencedCard(optional, []);
  assert.equal(mapped.title, null); assert.equal(mapped.recipient_name, null); assert.equal(mapped.customization, null);
});

test('zero unsigned source IDs are preserved and absent old migration history is supported', async () => {
  assert.equal(decimalId('0'), '0');
  assert.equal(mapMysqlCard(row('0'), [photo('0', '1')]).legacy_mysql_id, '0');
  const queries = [];
  const source = createMysqlSource({ async query() { throw Object.assign(new Error('no history'), { code: 'ER_NO_SUCH_TABLE' }); },
    async execute(sql, values) { queries.push({ sql, values }); return [[]]; } });
  assert.deepEqual(await source.history(), []);
  await source.cardsAfter(null, 250); await source.cardsAfter('0', 250);
  assert.match(queries[0].sql, /id >= \?/); assert.match(queries[1].sql, /id > \?/);
});

test('referenced import refuses same database name even with different connection aliases', () => {
  assert.throws(() => readReferencedSettings({ ...connectionEnv,
    SOURCE_MONGODB_URI: 'mongodb://different-host:27017', SOURCE_MONGODB_DB_NAME: 'cards_staging' }));
  assert.equal(readReferencedSettings({ ...connectionEnv,
    SOURCE_MONGODB_URI: 'mongodb://localhost:27017', SOURCE_MONGODB_DB_NAME: 'old_cards' }).apply, false);
});

test('referenced conversion dry-run is read-only and applied rerun is idempotent', async () => {
  const { parent, metadata } = referencedFixture(); delete metadata.id;
  const source = fakeDatabase({ cards: [parent], card_media: [metadata], schema_migrations: [{ _id: 'original', checksum: 'old' }] });
  const database = fakeDatabase(); const args = { source, database, sourceId: 'referenced' };
  assert.equal((await importReferenced(args)).cards, 1);
  assert.deepEqual(database.calls, []); assert.deepEqual(source.calls, []);
  assert.equal((await importReferenced({ ...args, apply: true, emptyAcknowledged: true })).inserted, 1);
  assert.equal((await importReferenced({ ...args, apply: true })).inserted, 0);
  assert.ok(database.stores.get('cards')[0]._id.equals(parent._id));
  assert.deepEqual(source.calls, []);
});

test('referenced checkpoints use ObjectIds even when SQL legacy IDs are also retained', async () => {
  const { parent } = referencedFixture();
  parent.legacy_mysql_id = '18446744073709551615';
  const source = fakeDatabase({ cards: [parent] });
  const database = fakeDatabase();
  const args = { source, database, sourceId: 'referenced', apply: true };
  assert.equal((await importReferenced({ ...args, emptyAcknowledged: true })).inserted, 1);
  assert.equal(database.stores.get('schema_migrations')[0].last_id, parent._id.toHexString());
  assert.equal((await importReferenced(args)).inserted, 0);
});

test('import dry-run rejects BSON size and JSON text/key values that cannot round-trip', () => {
  for (const json of ['"\\ud800"', '{"\\ud800":1}', '{"a\\u0000b":1}']) assert.throws(() => parseMysqlJson(json));
  assert.throws(() => mapMysqlCard({ ...row(), message: 'x'.repeat(16 * 1024 * 1024) }, []));
  const { parent } = referencedFixture();
  assert.throws(() => mapReferencedCard({ ...parent, customization: { ['bad\0key']: 1 } }, []));
  assert.throws(() => mapReferencedCard({ ...parent, message: 'x'.repeat(16 * 1024 * 1024) }, []));
});

test('real database verification requires explicit test credentials and a separate _test database', () => {
  const allowed = { ALLOW_MONGODB_INTEGRATION_TEST: 'true', MONGODB_TEST_URI: 'mongodb://localhost:27017',
    MONGODB_TEST_DB_NAME: 'cards_test', MONGODB_DB_NAME: 'production_cards' };
  assert.throws(() => readVerificationSettings({ MONGODB_URI: allowed.MONGODB_TEST_URI, MONGODB_DB_NAME: 'production_cards' }));
  assert.throws(() => readVerificationSettings({ ...allowed, ALLOW_MONGODB_INTEGRATION_TEST: 'false' }));
  assert.throws(() => readVerificationSettings({ ...allowed, MONGODB_TEST_DB_NAME: 'production_cards' }));
  assert.throws(() => readVerificationSettings({ ...allowed, MONGODB_DB_NAME: 'cards_test' }));
  assert.equal(readVerificationSettings(allowed).databaseName, 'cards_test');
});

test('referenced source root ObjectId cannot be replaced even when SQL legacy identity/content match', async () => {
  const expected = { ...mapMysqlCard(row(), [photo()]), legacy_mongodb_imported: true };
  const existing = { ...expected, _id: new ObjectId() };
  const database = fakeDatabase({ cards: [existing] });
  await assert.rejects(inspectCardConflict(database.collection('cards'), expected, { requireObjectId: true }), { code: 'IMPORT_CONFLICT' });
  assert.deepEqual(database.calls, []);
});

test('invalid persisted checkpoint is rejected before new staging records are written', async () => {
  const database = fakeDatabase({ schema_migrations: [{ _id: 'import_mysql:source', kind: 'mysql-import', source_id: 'source',
    last_id: null, card_count: 2, media_count: 0, state: 'running' }] });
  await assert.rejects(importMysql({ source: fakeSource(), database, sourceId: 'source', apply: true }), { code: 'IMPORT_CHECKPOINT' });
  assert.deepEqual(database.calls, []);
});

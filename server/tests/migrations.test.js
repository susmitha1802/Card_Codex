import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureMongoSchema, mongoSchemaDefinitions } from '../scripts/migration-runner.js';
import { schemaMigrationId, stableSchemaChecksum } from '../src/card-schema.js';

const leaseId = '__mongo_schema_lease';
function fakeDatabase({ existingCards = false, incompatibleCards = false, referencedPhotos = false, indexMutation, failIndexes = false } = {}) {
  const metadata = new Map();
  const records = new Map();
  const indexes = new Map();
  const calls = [];
  if (existingCards) {
    metadata.set('cards', { name: 'cards', options: { validator: { $jsonSchema: { bsonType: 'object' } } } });
    indexes.set('cards', []);
  }
  if (referencedPhotos) metadata.set('card_media', { name: 'card_media', options: {} });
  const db = {
    metadata, records, indexes, calls,
    listCollections(filter, options) {
      calls.push(['listCollections', filter, options]);
      return { async toArray() { return [...metadata.values()]; } };
    },
    async createCollection(name, options) {
      calls.push(['createCollection', name, options]);
      metadata.set(name, { name, options });
      indexes.set(name, []);
    },
    async command(command) {
      calls.push(['command', command]);
      if (command.collMod) metadata.get(command.collMod).options = { ...metadata.get(command.collMod).options, ...command };
    },
    collection(name) {
      return {
        async findOne(filter, options) {
          calls.push(['findOne', name, filter, options]);
          if (name === 'schema_migrations') return records.get(filter._id) ?? null;
          if (name === 'card_media') return referencedPhotos ? { _id: 'private-id' } : null;
          return incompatibleCards ? { _id: 'private-id' } : null;
        },
        async findOneAndUpdate(filter, pipeline, options) {
          calls.push(['findOneAndUpdate', name, filter, pipeline, options]);
          const current = records.get(filter._id);
          if (!current) return null;
          if (filter.owner !== undefined && (current.owner !== filter.owner || current.fence !== filter.fence)) return null;
          if (filter.$expr?.$lte && current.expires_at > new Date()) return null;
          if (filter.$expr?.$gt && current.expires_at <= new Date()) return null;
          const set = pipeline[0].$set;
          if (set.owner !== undefined) current.owner = set.owner;
          if (set.fence) current.fence += 1;
          if (set.expires_at) current.expires_at = new Date(Date.now() + set.expires_at.$add[1]);
          return structuredClone(current);
        },
        async updateOne(filter, update, options) {
          calls.push(['updateOne', name, filter, update, options]);
          let record = records.get(filter._id);
          if (!record && options.upsert) { record = { _id: filter._id, ...structuredClone(update.$setOnInsert) }; records.set(filter._id, record); }
          if (!record || (filter.owner !== undefined && (record.owner !== filter.owner || record.fence !== filter.fence))
            || (filter.$expr?.$gt && record.expires_at <= new Date())) return { matchedCount: 0 };
          for (const [key, value] of Object.entries(update.$set ?? {})) {
            if (key.startsWith('completed.')) record.completed[key.slice('completed.'.length)] = structuredClone(value);
            else record[key] = value;
          }
          return { matchedCount: 1 };
        },
        listIndexes(options) {
          calls.push(['listIndexes', name, options]);
          return { async toArray() {
            const current = structuredClone(indexes.get(name) ?? []);
            indexMutation?.(current);
            return current;
          } };
        },
        async createIndexes(definitions, options) {
          calls.push(['createIndexes', name, definitions, options]);
          await db.onCreateIndexes?.();
          if (failIndexes) throw new Error('index creation failed');
          indexes.set(name, [...(indexes.get(name) ?? []), ...structuredClone(definitions)]);
        },
      };
    },
  };
  return db;
}

test('setup creates only embedded cards and journals a versioned SHA256 checksum idempotently', async () => {
  const db = fakeDatabase();
  db.records.set('001_mongodb_collections_and_indexes', { checksum: 'original-history' });
  await ensureMongoSchema(db);
  await ensureMongoSchema(db);
  assert.equal(db.metadata.has('cards'), true);
  assert.equal(db.metadata.has('card_media'), false);
  assert.equal(db.calls.filter(([type]) => type === 'createCollection').length, 1);
  assert.equal(db.calls.filter(([type]) => type === 'createIndexes').length, 1);
  assert.match(db.records.get(schemaMigrationId).checksum, /^[0-9a-f]{64}$/);
  assert.equal(db.records.get(schemaMigrationId).checksum, stableSchemaChecksum());
  assert.equal(db.records.get('001_mongodb_collections_and_indexes').checksum, 'original-history');
  assert.equal(db.records.get(leaseId).owner, null);
  assert.equal(db.records.get(leaseId).fence, 2);
});

test('stable migration checksums ignore object property order and detect changed rules', () => {
  const reverse = (value) => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
  assert.equal(stableSchemaChecksum(), stableSchemaChecksum(reverse(mongoSchemaDefinitions)));
  const changed = structuredClone(mongoSchemaDefinitions);
  changed.cards.validator.$and[0].$jsonSchema.properties.media.maxItems = 5;
  assert.notEqual(stableSchemaChecksum(), stableSchemaChecksum(changed));
});

test('applied checksum changes halt before modifying collection metadata', async () => {
  const db = fakeDatabase();
  db.records.set(schemaMigrationId, { checksum: 'unexpected' });
  await assert.rejects(ensureMongoSchema(db), /checksum/);
  assert.equal(db.calls.some(([type]) => type === 'createCollection'), false);
  assert.equal(db.records.get(leaseId).owner, null);
});

test('empty existing cards can receive validation but incompatible cards and referenced photos require staging', async () => {
  const empty = fakeDatabase({ existingCards: true });
  await ensureMongoSchema(empty);
  assert.equal(empty.calls.filter(([type]) => type === 'command').length, 1);
  for (const db of [fakeDatabase({ existingCards: true, incompatibleCards: true }), fakeDatabase({ referencedPhotos: true })]) {
    await assert.rejects(ensureMongoSchema(db), /staged migration/);
    assert.equal(db.calls.some(([type]) => ['createCollection', 'command', 'createIndexes'].includes(type)), false);
    assert.equal(db.records.has(schemaMigrationId), false);
  }
});

test('conflicting indexes are rejected without dropping or replacing existing data', async () => {
  const db = fakeDatabase({ existingCards: true, indexMutation: (indexes) => indexes.push({
    name: 'cards_share_token_unique', key: { share_token: 1 }, unique: false,
  }) });
  await assert.rejects(ensureMongoSchema(db), /Conflicting schema index/);
  assert.equal(db.calls.some(([type]) => ['command', 'createIndexes'].includes(type)), false);
  assert.equal(db.records.has(schemaMigrationId), false);
});

test('failed schema work is never marked applied and the next run can retry', async () => {
  const db = fakeDatabase({ failIndexes: true });
  await assert.rejects(ensureMongoSchema(db), /index creation failed/);
  assert.equal(db.records.has(schemaMigrationId), false);
  assert.equal(db.records.get(leaseId).completed[schemaMigrationId], undefined);
  assert.equal(db.records.get(leaseId).owner, null);
});

test('bounded lease contention serializes concurrent migration jobs', async () => {
  const db = fakeDatabase();
  let unblock;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  db.onCreateIndexes = async () => { started(); await new Promise((resolve) => { unblock = resolve; }); };
  const first = ensureMongoSchema(db);
  await ready;
  await assert.rejects(ensureMongoSchema(db, { lockWaitMS: 20 }), /Another schema migration/);
  unblock();
  await first;
  assert.equal(db.records.get(leaseId).fence, 1);
});

test('an old owner cannot mark completion or release a successor lease', async () => {
  const db = fakeDatabase();
  db.onCreateIndexes = async () => {
    const lease = db.records.get(leaseId);
    lease.owner = 'successor'; lease.fence += 1;
  };
  await assert.rejects(ensureMongoSchema(db), /lease was lost/);
  assert.equal(db.records.has(schemaMigrationId), false);
  assert.equal(db.records.get(leaseId).owner, 'successor');
});

test('completion journal recovers the migration row after a interrupted row write', async () => {
  const db = fakeDatabase();
  await ensureMongoSchema(db);
  const original = db.records.get(schemaMigrationId);
  db.records.delete(schemaMigrationId);
  await ensureMongoSchema(db);
  assert.equal(db.records.get(schemaMigrationId).checksum, original.checksum);
  assert.equal(db.records.get(schemaMigrationId).fence, original.fence);
});

test('new schema enforces private roots, known new appearance, per-field photo uniqueness and no expiry deletion', () => {
  const definition = mongoSchemaDefinitions.cards;
  const schema = definition.validator.$and[0].$jsonSchema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.media.items.additionalProperties, false);
  assert.ok(!Object.hasOwn(schema.properties, 'code'));
  assert.ok(schema.required.includes('schema_version') && schema.required.includes('media'));
  assert.equal(definition.validator.$and[1].$expr.$cond[1].$and.length, 3);
  assert.equal(schema.properties.media.uniqueItems, undefined);
  assert.ok(definition.indexes.every((index) => index.expireAfterSeconds === undefined));
  assert.ok(definition.indexes.filter((index) => index.key['media.media_id'] || index.key['media.storage_key'])
    .every((index) => index.partialFilterExpression));
});

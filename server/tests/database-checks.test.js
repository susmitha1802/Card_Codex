import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseChecks } from '../src/database-checks.js';
import { mongoSchemaDefinitions } from '../src/card-schema.js';

function database({ missingCollection, mutateValidation, mutateIndexes, collectionOptions = {}, failPing = false } = {}) {
  const calls = [];
  return {
    calls,
    async command(command, options) {
      calls.push(['command', command, options]);
      if (failPing) throw new Error('private Atlas URI');
    },
    listCollections(filter, options) {
      // Reproduce Atlas's restricted metadata filter support.
      assert.equal(typeof filter.name, 'string', 'Collection lookup must use an exact name, not $in.');
      calls.push(['listCollections', filter, options]);
      return { async toArray() {
        return Object.entries(mongoSchemaDefinitions).filter(([name]) => name === filter.name && name !== missingCollection)
          .map(([name, definition]) => {
            const validation = { validator: structuredClone(definition.validator), validationAction: 'error', validationLevel: 'strict', ...collectionOptions };
            mutateValidation?.(validation);
            return { name, options: validation };
          });
      } };
    },
    collection(name) {
      return {
        listIndexes(options) {
          calls.push(['listIndexes', name, options]);
          return { async toArray() {
            const indexes = structuredClone(mongoSchemaDefinitions[name].indexes);
            mutateIndexes?.(indexes);
            return indexes;
          } };
        },
      };
    },
  };
}

test('combined readiness uses one admission slot and one decreasing deadline for metadata only', async () => {
  const db = database();
  let admitted = 0;
  let remaining = 3000;
  const checks = createDatabaseChecks(db, { runOperation: async (operation) => {
    admitted += 1;
    return operation({ remainingMS: () => remaining -= 10 });
  } });
  await checks.checkReadyDatabase();
  assert.equal(admitted, 1);
  assert.deepEqual(db.calls[0], ['command', { ping: 1 }, { maxTimeMS: 2990, timeoutMS: 2990 }]);
  assert.deepEqual(db.calls[1][1], { name: 'cards' });
  assert.equal(db.calls[1][2].maxTimeMS, 2980);
  assert.equal(db.calls[2][2].timeoutMS, 2970);
  assert.ok(db.calls.every(([call]) => ['command', 'listCollections', 'listIndexes'].includes(call)));
});

test('separate database and schema probes preserve existing interfaces', async () => {
  const db = database();
  const checks = createDatabaseChecks(db);
  await checks.checkDatabase();
  await checks.checkSchema();
  assert.equal(db.calls[0][1].ping, 1);
  assert.ok(db.calls[0][2].maxTimeMS > 0 && db.calls[0][2].maxTimeMS <= 3000);
});

test('missing collection and a failed ping reject readiness', async () => {
  await assert.rejects(createDatabaseChecks(database({ missingCollection: 'cards' })).checkSchema(), /Missing required collection/);
  await assert.rejects(createDatabaseChecks(database({ failPing: true })).checkReadyDatabase(), /private Atlas URI/);
});

test('readiness verifies complete validators and enforcement settings', async () => {
  const alterations = [
    (options) => { delete options.validator.$and[0].$jsonSchema.properties.media; },
    (options) => { options.validator.$and[0].$jsonSchema.additionalProperties = true; },
    (options) => { options.validator.$and.pop(); },
    (options) => { options.validationAction = 'warn'; },
    (options) => { options.validationLevel = 'moderate'; },
  ];
  for (const mutateValidation of alterations) {
    await assert.rejects(createDatabaseChecks(database({ mutateValidation })).checkSchema(), /document validation/);
  }
});

test('binary default collation is accepted when MongoDB omits simple index collation', async () => {
  await createDatabaseChecks(database({ mutateIndexes: (indexes) => indexes.forEach((index) => delete index.collation) })).checkSchema();
  await assert.rejects(createDatabaseChecks(database({ collectionOptions: { collation: { locale: 'en', strength: 2 } } })).checkSchema(), /collation/);
  await assert.rejects(createDatabaseChecks(database({ mutateIndexes: (indexes) => { indexes[0].collation = { locale: 'en', strength: 2 }; } })).checkSchema(), /index/);
});

test('readiness rejects missing, nonunique, sparse, hidden, partial-filter and TTL index drift', async () => {
  const alterations = [
    (indexes) => { indexes.pop(); },
    (indexes) => { indexes[0].unique = false; },
    (indexes) => { indexes[0].sparse = true; },
    (indexes) => { indexes[0].hidden = true; },
    (indexes) => { delete indexes[1].partialFilterExpression; },
    (indexes) => { indexes[1].partialFilterExpression = { 'media.media_id': { $exists: false } }; },
    (indexes) => { indexes.push({ name: 'expiry', key: { expires_at: 1 }, expireAfterSeconds: 0 }); },
  ];
  for (const mutateIndexes of alterations) await assert.rejects(createDatabaseChecks(database({ mutateIndexes })).checkSchema(), /index/);
});

test('readiness stops before further metadata calls when the operation budget expires', async () => {
  const db = database();
  let accesses = 0;
  const checks = createDatabaseChecks(db, { runOperation: async (operation) => operation({ remainingMS() {
    accesses += 1;
    if (accesses > 1) throw new Error('deadline');
    return 20;
  } }) });
  await assert.rejects(checks.checkReadyDatabase(), /deadline/);
  assert.equal(db.calls.length, 1);
});

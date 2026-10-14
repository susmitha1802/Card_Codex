import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  mongoSchemaDefinitions, schemaMigrationId, stableSchemaChecksum, equalDefinition, matchesRequiredIndex,
} from '../src/card-schema.js';

export { mongoSchemaDefinitions } from '../src/card-schema.js';
const leaseId = '__mongo_schema_lease';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// The lease document is also the authoritative completion journal. Its owner,
// expiry and fencing number are checked atomically before recording completion.
// The individual migration row is a recoverable copy for human inspection.
export async function ensureMongoSchema(database, {
  leaseMS = 30000, lockWaitMS = 10000, operationTimeoutMS = 10000, jobTimeoutMS = 120000,
} = {}) {
  if (![leaseMS, lockWaitMS, operationTimeoutMS, jobTimeoutMS].every((value) => Number.isInteger(value) && value > 0)
    || leaseMS < 300 || operationTimeoutMS >= leaseMS) throw new Error('Invalid schema migration deadlines.');
  const owner = randomUUID();
  const deadline = performance.now() + jobTimeoutMS;
  const migrations = database.collection('schema_migrations');
  const checksum = stableSchemaChecksum();
  const options = () => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw new Error('Schema migration deadline exceeded.');
    return { maxTimeMS: Math.min(operationTimeoutMS, remaining), timeoutMS: Math.min(operationTimeoutMS, remaining),
      writeConcern: { w: 'majority', wtimeoutMS: Math.min(operationTimeoutMS, remaining) } };
  };
  const readOptions = () => {
    const { maxTimeMS, timeoutMS } = options();
    return { maxTimeMS, timeoutMS };
  };
  try {
    await migrations.updateOne({ _id: leaseId }, {
      $setOnInsert: { owner: null, fence: 0, expires_at: new Date(0), completed: {} },
    }, { upsert: true, ...options() });
  } catch (error) {
    // Concurrent first-ever setup jobs may race to create the same unique _id.
    // Neither job overwrites the lease; both still need the atomic acquisition.
    if (error.code !== 11000) throw error;
  }
  const acquisitionDeadline = Math.min(deadline, performance.now() + lockWaitMS);
  let lease;
  do {
    lease = await migrations.findOneAndUpdate({ _id: leaseId, $expr: { $lte: ['$expires_at', '$$NOW'] } }, [{
      $set: { owner, fence: { $add: ['$fence', 1] }, expires_at: { $add: ['$$NOW', leaseMS] } },
    }], { returnDocument: 'after', includeResultMetadata: false, ...options() });
    if (!lease && performance.now() < acquisitionDeadline) await sleep(Math.min(100, Math.ceil(acquisitionDeadline - performance.now())));
  } while (!lease && performance.now() < acquisitionDeadline);
  if (!lease) throw new Error('Another schema migration is running.');

  const held = { _id: leaseId, owner, fence: lease.fence, $expr: { $gt: ['$expires_at', '$$NOW'] } };
  let renewalFailure;
  let pendingRenewal = Promise.resolve();
  function renew() {
    pendingRenewal = pendingRenewal.then(async () => {
      if (renewalFailure) throw renewalFailure;
      const result = await migrations.findOneAndUpdate(held, [{
        $set: { expires_at: { $add: ['$$NOW', leaseMS] } },
      }], { returnDocument: 'after', includeResultMetadata: false, ...options() });
      if (!result) throw new Error('Schema migration lease was lost.');
    }).catch((error) => { renewalFailure = error; throw error; });
    return pendingRenewal;
  }
  const timer = setInterval(() => { renew().catch(() => {}); }, Math.floor(leaseMS / 3));
  timer.unref?.();
  async function guarded(operation) {
    await renew();
    const result = await operation();
    await renew();
    return result;
  }
  try {
    const prior = await guarded(() => migrations.findOne({ _id: schemaMigrationId }, readOptions()));
    const journal = lease.completed?.[schemaMigrationId];
    if ((prior && prior.checksum !== checksum) || (journal && journal.checksum !== checksum)) {
      throw new Error('Applied schema migration checksum does not match its definition.');
    }
    const existing = new Map((await guarded(() => database.listCollections({},
      { nameOnly: false, ...readOptions() }).toArray())).map((collection) => [collection.name, collection]));
    if (existing.has('card_media') && await guarded(() => database.collection('card_media').findOne({},
      { projection: { _id: 1 }, ...readOptions() }))) {
      throw new Error('Referenced photo data requires a staged migration before embedded schema setup.');
    }
    // Inspect only identifiers of incompatible records. Setup never converts or
    // deletes pre-existing content, and never silently tightens validation over it.
    if (existing.has('cards')) {
      const incompatible = await guarded(() => database.collection('cards').findOne(
        { $nor: [mongoSchemaDefinitions.cards.validator] }, { projection: { _id: 1 }, ...readOptions() }));
      if (incompatible) throw new Error('Existing card data requires a staged migration before embedded schema setup.');
    }
    for (const [name, definition] of Object.entries(mongoSchemaDefinitions)) {
      const metadata = existing.get(name);
      const collection = database.collection(name);
      if (metadata?.options?.collation && metadata.options.collation.locale !== 'simple') {
        throw new Error('Schema setup requires binary collection collation.');
      }
      const indexes = metadata ? await guarded(() => collection.listIndexes(readOptions()).toArray()) : [];
      if (indexes.some((index) => index.expireAfterSeconds !== undefined)) throw new Error('Conflicting expiry index requires manual review.');
      for (const required of definition.indexes) {
        const actual = indexes.find((index) => index.name === required.name);
        if (actual && !matchesRequiredIndex(actual, required, metadata?.options)) throw new Error('Conflicting schema index requires manual review.');
        if (indexes.some((index) => index.name !== required.name && JSON.stringify(index.key) === JSON.stringify(required.key))) {
          throw new Error('Conflicting schema index name requires manual review.');
        }
      }
      const validation = { validator: definition.validator, validationLevel: 'strict', validationAction: 'error' };
      if (!metadata) {
        await guarded(() => database.createCollection(name, { ...validation, collation: { locale: 'simple' }, ...options() }));
      } else if (!equalDefinition(metadata.options?.validator, definition.validator)
        || metadata.options?.validationLevel !== 'strict' || metadata.options?.validationAction !== 'error') {
        if (prior || journal) throw new Error('Applied schema validation differs from its recorded migration.');
        await guarded(() => database.command({ collMod: name, ...validation,
          writeConcern: { w: 'majority', wtimeout: Math.min(operationTimeoutMS, Math.ceil(deadline - performance.now())) } },
          readOptions()));
      }
      const missing = definition.indexes.filter((required) => !indexes.some((index) => index.name === required.name));
      if (missing.length) await guarded(() => collection.createIndexes(missing, options()));
    }
    await renew();
    const completion = prior ?? journal ?? { checksum, applied_at: new Date(), fence: lease.fence };
    const recorded = await migrations.updateOne(held, { $set: { [`completed.${schemaMigrationId}`]: completion } }, options());
    if (recorded.matchedCount !== 1) throw new Error('Schema migration lease was lost before completion.');
    await guarded(() => migrations.updateOne({ _id: schemaMigrationId }, {
      $setOnInsert: { checksum: completion.checksum, applied_at: completion.applied_at, fence: completion.fence },
    }, { upsert: true, ...options() }));
  } finally {
    clearInterval(timer);
    await pendingRenewal.catch(() => {});
    // An expired owner's fencing token cannot release a successor's lease.
    await migrations.updateOne({ _id: leaseId, owner, fence: lease.fence },
      { $set: { owner: null, expires_at: new Date(0) } }, { maxTimeMS: operationTimeoutMS, timeoutMS: operationTimeoutMS, writeConcern: { w: 'majority', wtimeoutMS: operationTimeoutMS } })
      .catch(() => {});
  }
}

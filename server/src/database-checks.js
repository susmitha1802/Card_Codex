import { performance } from 'node:perf_hooks';
import { equalDefinition, matchesRequiredIndex, mongoSchemaDefinitions } from './card-schema.js';

export function createDatabaseChecks(database, { runOperation, operationTimeoutMS = 3000 } = {}) {
  const run = runOperation ?? (async (operation) => {
    const deadline = performance.now() + operationTimeoutMS;
    return operation({ remainingMS() {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) throw new Error('Database check deadline exceeded.');
      return remaining;
    } });
  });
  const options = (scope) => {
    const remaining = Math.max(1, scope.remainingMS());
    return { maxTimeMS: remaining, timeoutMS: remaining };
  };
  const ping = async (scope) => { await database.command({ ping: 1 }, options(scope)); };
  async function schema(scope) {
    for (const [name, expected] of Object.entries(mongoSchemaDefinitions)) {
      // Some Atlas tiers reject operator filters such as $in for listCollections.
      // Exact-name metadata queries work there and retain the same shared deadline.
      const [collection] = await database.listCollections({ name },
        { nameOnly: false, ...options(scope) }).toArray();
      if (!collection) throw new Error(`Missing required collection: ${name}`);
      const actual = collection.options ?? {};
      if (actual.validationLevel !== 'strict' || actual.validationAction !== 'error'
        || !equalDefinition(actual.validator, expected.validator)) {
        throw new Error(`Missing required document validation: ${name}`);
      }
      if (actual.collation && actual.collation.locale !== 'simple') throw new Error(`Invalid collection collation: ${name}`);
      const indexes = await database.collection(name).listIndexes(options(scope)).toArray();
      if (indexes.some((index) => index.expireAfterSeconds !== undefined)) throw new Error(`Unexpected expiry index: ${name}`);
      for (const required of expected.indexes) {
        if (!matchesRequiredIndex(indexes.find((index) => index.name === required.name), required, actual)) {
          throw new Error(`Missing required index: ${name}`);
        }
      }
    }
  }
  return {
    checkDatabase: () => run(ping),
    checkSchema: () => run(schema),
    checkReadyDatabase: () => run(async (scope) => { await ping(scope); await schema(scope); }),
  };
}

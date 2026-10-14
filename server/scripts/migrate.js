import { ensureMongoSchema } from './migration-runner.js';

let client;
try {
  const databaseModule = await import('../src/db.js');
  client = databaseModule.client;
  await databaseModule.client.connect();
  await ensureMongoSchema(databaseModule.database);
  console.log('MongoDB collections and indexes are ready.');
} catch (error) {
  console.error(error.isConfigurationError ? error.message : 'MongoDB setup failed. Check Atlas access and database permissions.');
  process.exitCode = 1;
} finally {
  await client?.close();
}

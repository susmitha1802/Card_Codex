import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { createDatabaseChecks } from './database-checks.js';
import { createDatabaseAdmission } from './database-admission.js';
import { createDatabaseConnection } from './database-client.js';

const { uri, databaseName, ...options } = config.database;
export const client = new MongoClient(uri, options);
export const database = client.db(databaseName);
export const pool = client;
const admission = createDatabaseAdmission({
  maxConcurrent: config.database.maxPoolSize,
  queueLimit: config.databaseQueueLimit,
  operationTimeoutMS: config.database.timeoutMS,
  waitQueueTimeoutMS: config.database.waitQueueTimeoutMS,
});
export const { runDatabaseOperation, closeDatabase } = createDatabaseConnection(client, admission);

export { createDatabaseChecks } from './database-checks.js';
export const { checkDatabase, checkSchema, checkReadyDatabase } = createDatabaseChecks(database, {
  runOperation: runDatabaseOperation,
  operationTimeoutMS: config.database.timeoutMS,
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseAdmission } from '../src/database-admission.js';
import { createDatabaseConnection } from '../src/database-client.js';

test('an initial connection failure can recover without restarting the application', async () => {
  let attempts = 0; let operations = 0;
  const client = { async connect() { if (++attempts === 1) throw new Error('private Atlas URI'); }, async close() {} };
  const connection = createDatabaseConnection(client, createDatabaseAdmission());
  await assert.rejects(connection.runDatabaseOperation(() => { operations++; }),
    (error) => error.code === 'DATABASE_CONNECTION_UNAVAILABLE' && error.safeToCleanupPhotos && !error.message.includes('private'));
  assert.equal(operations, 0);
  assert.equal(await connection.runDatabaseOperation(() => { operations++; return 'ready'; }), 'ready');
  assert.equal(attempts, 2); assert.equal(operations, 1);
  await connection.closeDatabase();
});

test('shutdown stops queued work and waits for active work before closing the client', async () => {
  let finish; let closed = 0;
  const client = { async connect() {}, async close() { closed++; } };
  const connection = createDatabaseConnection(client, createDatabaseAdmission({ maxConcurrent: 1, queueLimit: 1 }));
  const active = connection.runDatabaseOperation(() => new Promise((resolve) => { finish = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const queued = connection.runDatabaseOperation(() => assert.fail('Queued work cannot run during shutdown.'));
  const stopping = connection.closeDatabase();
  await assert.rejects(queued, { code: 'DATABASE_CLOSED', safeToCleanupPhotos: true });
  assert.equal(closed, 0);
  await assert.rejects(connection.runDatabaseOperation(() => assert.fail()), { code: 'DATABASE_CLOSED' });
  finish('done'); assert.equal(await active, 'done');
  await stopping; assert.equal(closed, 1);
  await connection.closeDatabase(); assert.equal(closed, 1);
});

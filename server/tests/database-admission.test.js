import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabaseAdmission } from '../src/database-admission.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function admissionError(code, safe) {
  return (error) => error.name === 'DatabaseAdmissionError'
    && error.code === code && error.safeToCleanupPhotos === safe;
}

test('admission allows configured concurrent work and bounds pending requests by count', async () => {
  const { runDatabaseOperation: run } = createDatabaseAdmission({ maxConcurrent: 2,
    queueLimit: 1, operationTimeoutMS: 1000, waitQueueTimeoutMS: 500 });
  const held = deferred();
  let active = 0;
  let maximum = 0;
  let queuedStarted = false;
  const work = () => run(async () => {
    active += 1; maximum = Math.max(maximum, active);
    await held.promise;
    active -= 1;
  });
  const first = work();
  const second = work();
  const third = run(() => { queuedStarted = true; });
  await assert.rejects(run(() => assert.fail('rejected work cannot run')), admissionError('DATABASE_QUEUE_FULL', true));
  assert.equal(maximum, 2);
  assert.equal(queuedStarted, false);
  held.resolve();
  await Promise.all([first, second, third]);
  assert.equal(queuedStarted, true);
});

test('waiting requests expire before invoking their callback and release their queue capacity', async () => {
  const { runDatabaseOperation: run } = createDatabaseAdmission({ maxConcurrent: 1,
    queueLimit: 1, operationTimeoutMS: 1000, waitQueueTimeoutMS: 20 });
  const held = deferred();
  const first = run(() => held.promise);
  let started = false;
  await assert.rejects(run(() => { started = true; }), admissionError('DATABASE_QUEUE_TIMEOUT', true));
  assert.equal(started, false);
  const next = run(() => 'next');
  held.resolve();
  assert.equal(await next, 'next');
  await first;
});

test('queue waiting consumes the same operation budget used by the callback', async () => {
  const { runDatabaseOperation: run } = createDatabaseAdmission({ maxConcurrent: 1,
    queueLimit: 1, operationTimeoutMS: 300, waitQueueTimeoutMS: 250 });
  const held = deferred();
  const first = run(() => held.promise);
  let remaining;
  const next = run((scope) => { remaining = scope.remainingMS(); });
  await delay(40);
  held.resolve();
  await Promise.all([first, next]);
  assert.ok(remaining <= 280 && remaining > 0);
});

test('active deadline rejects without freeing a slot while the underlying operation is unsettled', async () => {
  const { runDatabaseOperation: run } = createDatabaseAdmission({ maxConcurrent: 1,
    queueLimit: 1, operationTimeoutMS: 30, waitQueueTimeoutMS: 20 });
  const held = deferred();
  const first = run(() => held.promise);
  await assert.rejects(first, admissionError('DATABASE_OPERATION_TIMEOUT', false));
  let secondStarted = false;
  const queued = run(() => { secondStarted = true; });
  await assert.rejects(run(() => assert.fail('capacity must remain held')), admissionError('DATABASE_QUEUE_FULL', true));
  await assert.rejects(queued, admissionError('DATABASE_QUEUE_TIMEOUT', true));
  assert.equal(secondStarted, false);
  held.resolve();
  await delay(0);
  assert.equal(await run(() => 'settled'), 'settled');
});

test('caller abandonment does not cancel work or release capacity, and callback failure drains the queue', async () => {
  const { runDatabaseOperation: run } = createDatabaseAdmission({ maxConcurrent: 1,
    queueLimit: 1, operationTimeoutMS: 1000, waitQueueTimeoutMS: 500 });
  const held = deferred();
  const failure = new Error('safe test failure');
  const first = run(async () => { await held.promise; throw failure; });
  // The caller stops waiting while its operation is still alive.
  assert.equal(await Promise.race([first, Promise.resolve('caller stopped')]), 'caller stopped');
  let started = false;
  const next = run(() => { started = true; return 'after failure'; });
  assert.equal(started, false);
  const rejected = assert.rejects(first, (error) => error === failure);
  held.resolve();
  await rejected;
  assert.equal(await next, 'after failure');
});

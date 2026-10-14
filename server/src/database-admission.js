import { performance } from 'node:perf_hooks';

export class DatabaseAdmissionError extends Error {
  constructor(code, safeToCleanupPhotos) {
    super('The database operation could not finish within its resource limits.');
    this.name = 'DatabaseAdmissionError';
    this.code = code;
    this.safeToCleanupPhotos = safeToCleanupPhotos;
  }
}

// Limit both concurrent work and waiting requests. Driver waitQueueTimeoutMS
// alone places no limit on the number of requests that can be queued.
export function createDatabaseAdmission({ maxConcurrent = 5, queueLimit = 10,
  operationTimeoutMS = 3000, waitQueueTimeoutMS = 1000 } = {}) {
  for (const [name, value, minimum] of [['maxConcurrent', maxConcurrent, 1],
    ['queueLimit', queueLimit, 0], ['operationTimeoutMS', operationTimeoutMS, 1],
    ['waitQueueTimeoutMS', waitQueueTimeoutMS, 1]]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`Invalid ${name}.`);
  }
  let active = 0;
  let closing = false;
  const idleWaiters = [];
  const queue = [];

  function drain() {
    if (closing) {
      if (!active) idleWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    while (active < maxConcurrent && queue.length) start(queue.shift());
  }

  function start(entry) {
    clearTimeout(entry.queueTimer);
    const remaining = Math.ceil(entry.deadline - performance.now());
    if (remaining <= 0) {
      entry.reject(new DatabaseAdmissionError('DATABASE_OPERATION_TIMEOUT', true));
      return;
    }
    active += 1;
    const scope = {
      remainingMS() {
        const budget = Math.ceil(entry.deadline - performance.now());
        if (budget <= 0) throw new DatabaseAdmissionError('DATABASE_OPERATION_TIMEOUT', false);
        return budget;
      },
    };
    const activeTimer = setTimeout(() => {
      // A write may already have reached MongoDB. Keep its slot until the
      // underlying callback settles, even after an HTTP caller has timed out.
      entry.reject(new DatabaseAdmissionError('DATABASE_OPERATION_TIMEOUT', false));
    }, remaining);
    Promise.resolve().then(() => entry.callback(scope)).then(entry.resolve, entry.reject).finally(() => {
      clearTimeout(activeTimer);
      active -= 1;
      drain();
    });
  }

  function runDatabaseOperation(callback) {
    if (typeof callback !== 'function') return Promise.reject(new TypeError('A database callback is required.'));
    const deadline = performance.now() + operationTimeoutMS;
    return new Promise((resolve, reject) => {
      if (closing) { reject(new DatabaseAdmissionError('DATABASE_CLOSED', true)); return; }
      const entry = { callback, deadline, resolve, reject };
      if (active < maxConcurrent) { start(entry); return; }
      if (queue.length >= queueLimit) {
        reject(new DatabaseAdmissionError('DATABASE_QUEUE_FULL', true));
        return;
      }
      queue.push(entry);
      const delay = Math.min(waitQueueTimeoutMS, operationTimeoutMS);
      entry.queueTimer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(new DatabaseAdmissionError('DATABASE_QUEUE_TIMEOUT', true));
      }, delay);
    });
  }

  function close() {
    closing = true;
    for (const entry of queue.splice(0)) {
      clearTimeout(entry.queueTimer);
      entry.reject(new DatabaseAdmissionError('DATABASE_CLOSED', true));
    }
    return active ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
  }

  return { runDatabaseOperation, close };
}

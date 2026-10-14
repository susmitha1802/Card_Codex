import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createLogger } from '../src/logging.js';
import { registerShutdown } from '../src/shutdown.js';

function fakeProcess() {
  const instance = new EventEmitter();
  instance.exits = [];
  instance.exit = (code) => instance.exits.push(code);
  return instance;
}

test('structured logging accepts only known operational fields and never dumps errors or request data', () => {
  const lines = [];
  const log = createLogger((line) => lines.push(line));
  const privateData = 'DO_NOT_LOG_PRIVATE_DATA';
  log('server_started', { mode: 'production', port: 3001, servesFrontend: true,
    database: 'available', storage: 'unavailable', body: privateData, code: privateData,
    password: privateData, message: privateData, cookie: privateData, url: '/card/' + privateData,
    error: new Error(privateData), environment: { MONGODB_URI: privateData } });
  log('startup_failed', { reason: 'configuration', setting: 'MONGODB_URI', stack: privateData });
  log(privateData, { message: privateData });
  assert.equal(lines.length, 2);
  assert.ok(!lines.join('').includes(privateData));
  const first = JSON.parse(lines[0]);
  assert.equal(first.event, 'server_started');
  assert.equal(first.level, 'info');
  assert.equal(first.port, 3001);
  assert.equal(JSON.parse(lines[1]).setting, 'MONGODB_URI');
});

test('uncertain-write logging records only a fixed event and new configuration labels remain safe', () => {
  const lines = [];
  const log = createLogger((line) => lines.push(JSON.parse(line)));
  log('database_write_uncertain', { token: 'private-token', storageKey: 'private-file', error: new Error('private-uri') });
  assert.deepEqual(Object.keys(lines[0]), ['timestamp', 'level', 'event']);
  assert.equal(lines[0].event, 'database_write_uncertain');
  for (const setting of ['MONGODB_OPERATION_TIMEOUT_MS', 'MONGODB_QUEUE_LIMIT', 'MONGODB_MAX_IDLE_TIME_MS']) {
    log('startup_failed', { setting, value: 'private-value' });
    assert.equal(lines.at(-1).setting, setting);
    assert.equal(JSON.stringify(lines.at(-1)).includes('private-value'), false);
  }
});

test('graceful shutdown drains an actual active HTTP request before closing its database pool', async () => {
  let finishRequest;
  let poolClosed = false;
  const server = http.createServer((_request, response) => { finishRequest = () => response.end('finished'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const processObject = fakeProcess();
  const events = [];
  const lifecycle = registerShutdown({ server, pool: { async end() { poolClosed = true; } },
    log: (event) => events.push(event), processObject, timeoutMs: 1000 });
  const requestStarted = once(server, 'request');
  const request = fetch(`http://127.0.0.1:${server.address().port}`);
  await requestStarted;
  const stopping = lifecycle.shutdown();
  assert.equal(lifecycle.shutdown(), stopping);
  assert.equal(poolClosed, false);
  finishRequest();
  assert.equal(await (await request).text(), 'finished');
  assert.equal(await stopping, true);
  assert.equal(poolClosed, true);
  assert.deepEqual(events, ['shutdown_started', 'shutdown_complete']);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
  assert.deepEqual(processObject.exits, []);
});

test('shutdown enforces its deadline for a stuck cleanup without logging the original error', async () => {
  const processObject = fakeProcess();
  const events = [];
  let forced = false;
  const server = { close(done) { done(); }, closeIdleConnections() {}, closeAllConnections() { forced = true; } };
  const lifecycle = registerShutdown({ server, pool: { end() { return new Promise(() => {}); } },
    log: (event) => events.push(event), processObject, timeoutMs: 15 });
  assert.equal(await lifecycle.shutdown(), false);
  assert.equal(forced, true);
  assert.deepEqual(processObject.exits, [1]);
  assert.deepEqual(events, ['shutdown_started', 'shutdown_timeout']);
});

test('fatal exceptions are logged generically and trigger bounded shutdown with a failing exit code', async () => {
  const processObject = fakeProcess();
  const events = [];
  const server = { close(done) { setTimeout(done, 0); }, closeIdleConnections() {} };
  const lifecycle = registerShutdown({ server, pool: { async end() {} },
    log: (event) => events.push(event), processObject, timeoutMs: 100 });
  processObject.emit('uncaughtException', new Error('secret code and database password'));
  assert.equal(await lifecycle.shutdown(), true);
  assert.equal(processObject.exitCode, 1);
  assert.deepEqual(events, ['fatal_error', 'shutdown_started', 'shutdown_complete']);
});

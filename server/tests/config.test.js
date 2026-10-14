import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import { readConfig } from '../src/config-reader.js';

const production = { NODE_ENV: 'production', PUBLIC_APP_ORIGIN: 'https://cards.example',
  MONGODB_URI: 'mongodb+srv://cards_app:private-db-password@cluster.example.net/cards_production',
  MONGODB_DB_NAME: 'cards_production',
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true', MEDIA_DIRECTORY: resolve('private-persistent-volume') };

test('development keeps simple defaults and bounded MongoDB connection pooling', () => {
  const config = readConfig({});
  assert.equal(config.mode, 'development');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.serveFrontend, false);
  assert.equal(config.httpSecurity.trustProxy, false);
  assert.equal(config.database.maxPoolSize, 5);
  assert.equal(config.database.minPoolSize, 0);
  assert.equal(config.database.connectTimeoutMS, 3000);
  assert.equal(config.database.serverSelectionTimeoutMS, 3000);
  assert.equal(config.database.waitQueueTimeoutMS, 1000);
  assert.equal(config.database.timeoutMS, 3000);
  assert.equal(config.database.maxIdleTimeMS, 60000);
  assert.equal(config.databaseQueueLimit, 10);
});

test('production needs explicit HTTPS, MongoDB settings, and acknowledged persistent local storage', () => {
  assert.equal(readConfig(production).serveFrontend, true);
  for (const key of ['PUBLIC_APP_ORIGIN', 'MONGODB_URI', 'MONGODB_DB_NAME', 'MEDIA_DIRECTORY', 'ALLOW_LOCAL_STORAGE_IN_PRODUCTION']) {
    const env = { ...production }; delete env[key];
    assert.throws(() => readConfig(env), (error) => error.isConfigurationError && typeof error.setting === 'string');
  }
  assert.throws(() => readConfig({ ...production, PUBLIC_APP_ORIGIN: 'http://cards.example' }));
  assert.throws(() => readConfig({ ...production, MEDIA_DIRECTORY: 'relative-storage' }));
  assert.throws(() => readConfig({ ...production, ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'false' }));
});

test('malformed MongoDB URIs, numbers, pool bounds, names and drivers fail safely', () => {
  for (const [key, values] of Object.entries({ PORT: ['0', '65536', '3e3', '3001\n'],
    MONGODB_MAX_POOL_SIZE: ['0', '101'], MONGODB_MIN_POOL_SIZE: ['-1', '51'],
    MONGODB_CONNECT_TIMEOUT_MS: ['10', '30001'], MONGODB_WAIT_QUEUE_TIMEOUT_MS: ['10', '30001'],
    MONGODB_OPERATION_TIMEOUT_MS: ['0', '30001'], MONGODB_QUEUE_LIMIT: ['-1', '101'],
    MONGODB_MAX_IDLE_TIME_MS: ['0', '600001'],
    NODE_ENV: ['prod'], MONGODB_DB_NAME: ['bad-name', 'name\n'], HOST: ['127.0.0.1/path', 'localhost\n'], MEDIA_DRIVER: ['s3'] })) {
    for (const value of values) assert.throws(() => readConfig({ [key]: value }), (error) => error.isConfigurationError && error.setting === key);
  }
  const secret = 'secret-user:secret-password@private.example';
  assert.throws(() => readConfig({ PUBLIC_APP_ORIGIN: 'https://' + secret }), (error) => !error.message.includes(secret));
});

test('trusted proxies use explicit IPs/CIDRs, never blanket trust or hop counts', () => {
  assert.deepEqual(readConfig({ TRUST_PROXY: '127.0.0.1/32, ::1/128, 10.0.0.0/24' }).httpSecurity.trustProxy,
    ['127.0.0.1/32', '::1/128', '10.0.0.0/24']);
  for (const value of ['true', '1', '*', 'loopback', '0.0.0.0/0', '::/0', '127.0.0.1/33', '127.0.0.1,']) assert.throws(() => readConfig({ TRUST_PROXY: value }));
});

test('MongoDB accepts only mongodb and mongodb+srv connection URIs', () => {
  for (const uri of ['http://atlas.example', 'mongodb://', 'mongodb+srv://']) {
    assert.throws(() => readConfig({ MONGODB_URI: uri }), (error) => error.setting === 'MONGODB_URI');
  }
  assert.throws(() => readConfig({ MONGODB_MIN_POOL_SIZE: '6', MONGODB_MAX_POOL_SIZE: '5' }),
    (error) => error.setting === 'MONGODB_MIN_POOL_SIZE');
});

test('driver validation accepts multiple seed hosts and leaves localhost development without TLS', () => {
  const uri = 'mongodb://cards_user:encoded%40password@db-one.example:27017,db-two.example:27018/cards?replicaSet=cards';
  assert.equal(readConfig({ MONGODB_URI: uri }).database.uri, uri);
  const { uri: localUri, databaseName, ...options } = readConfig({}).database;
  assert.equal(new MongoClient(localUri, options).options.tls, undefined);
});

test('production rejects TLS bypasses and weak consistency in URI options without exposing the URI', () => {
  const forbidden = ['tls=false', 'ssl=false', 'TLS=false', 'tls=0', 'ssl=0',
    'tlsInsecure=true', 'tlsAllowInvalidCertificates=true', 'tlsAllowInvalidHostnames=true',
    'TLSALLOWINVALIDCERTIFICATES=true', 'TlsAllowInvalidHostnames=TRUE', 'tlsInsecure=1',
    'tls=true&tls=false', 'readPreference=secondary', 'readPreference=nearest',
    'retryWrites=false', 'w=0', 'w=1'];
  for (const options of forbidden) {
    const uri = `${production.MONGODB_URI}?${options}`;
    assert.throws(() => readConfig({ ...production, MONGODB_URI: uri }), (error) => {
      assert.equal(error.setting, 'MONGODB_URI');
      assert.equal(error.isConfigurationError, true);
      assert.equal(error.message.includes('private-db-password'), false);
      assert.equal(error.message.includes('cluster.example.net'), false);
      return true;
    });
  }
});

test('production applies verified TLS, primary reads, retryable writes, and majority writes to the effective client', () => {
  for (const uri of [production.MONGODB_URI,
    'mongodb://db-one.example:27017,db-two.example:27017/?replicaSet=cards',
    `${production.MONGODB_URI}?tlsAllowInvalidCertificates=false&w=majority&retryWrites=true&readPreference=primary`]) {
    const { uri: checkedUri, databaseName, ...options } = readConfig({ ...production, MONGODB_URI: uri }).database;
    const client = new MongoClient(checkedUri, options);
    assert.equal(client.options.tls, true);
    assert.equal(Boolean(client.options.tlsInsecure), false);
    assert.equal(Boolean(client.options.tlsAllowInvalidCertificates), false);
    assert.equal(Boolean(client.options.tlsAllowInvalidHostnames), false);
    assert.equal(client.options.readPreference.mode, 'primary');
    assert.equal(client.options.retryWrites, true);
    assert.equal(client.options.writeConcern.w, 'majority');
  }
});

test('MongoDB parser failures report only the safe setting label', () => {
  for (const suffix of ['?unsupportedOption=private-value', '?w=invalid&tls=true&ssl=false', '?readPreference=private-value']) {
    const uri = `mongodb://private-user:private-password@private-host.example/cards${suffix}`;
    assert.throws(() => readConfig({ MONGODB_URI: uri }), (error) => error.isConfigurationError
      && error.setting === 'MONGODB_URI' && !error.message.includes('private-'));
  }
  // Valid URI options can conflict with the application's primary-read policy.
  assert.throws(() => readConfig({ MONGODB_URI: 'mongodb://local.example/cards?readPreference=secondary&maxStalenessSeconds=90&readPreferenceTags=dc:private-value' }),
    (error) => error.isConfigurationError && error.setting === 'MONGODB_URI' && !error.message.includes('private-value'));
});

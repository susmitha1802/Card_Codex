import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { normalizePublicOrigin } from '../../shared/shareLinks.js';

export class ConfigurationError extends Error {
  constructor(setting, explanation) {
    super(`${setting}: ${explanation}`);
    this.name = 'ConfigurationError';
    this.isConfigurationError = true;
    this.setting = setting;
  }
}

function integer(env, name, fallback, min, max) {
  const input = env[name] ?? String(fallback);
  const value = Number(input);
  if (typeof input !== 'string' || input !== input.trim() || !/^\d+$/.test(input) || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(name, `use an integer from ${min} to ${max}.`);
  }
  return value;
}

function boolean(env, name) {
  const value = env[name] ?? 'false';
  if (!['true', 'false'].includes(value)) throw new ConfigurationError(name, 'use true or false.');
  return value === 'true';
}

function required(env, name) {
  if (typeof env[name] !== 'string' || !env[name].length) throw new ConfigurationError(name, 'set this explicitly in production.');
  return env[name];
}

export function validatePublicAppOrigin(value) {
  try {
    if (typeof value !== 'string' || /\s/.test(value)) throw new Error();
    return normalizePublicOrigin(value);
  }
  catch { throw new ConfigurationError('PUBLIC_APP_ORIGIN', 'use an HTTP(S) origin without a path, credentials, query, or fragment.'); }
}

function proxyAddresses(value) {
  if (!value || value === 'false') return false;
  const addresses = value.split(',').map((part) => part.trim());
  if (addresses.length > 16 || addresses.some((entry) => {
    const parts = entry.split('/');
    const version = isIP(parts[0]);
    if (!version || parts.length > 2) return true;
    if (parts.length === 1) return false;
    const prefix = Number(parts[1]);
    return !/^\d+$/.test(parts[1]) || !Number.isInteger(prefix) || prefix < 1 || prefix > (version === 4 ? 32 : 128);
  })) throw new ConfigurationError('TRUST_PROXY', 'use trusted proxy IPs/CIDRs, never true, hop counts, or all-address networks.');
  return addresses;
}

function validateMongoUri(uri, production) {
  try {
    if (typeof uri !== 'string' || uri !== uri.trim() || /\s/.test(uri)) throw new Error();
    // Use the driver's parser: a general URL parser rejects valid multi-host URIs.
    // Constructing a client validates options without opening a connection.
    const parsed = new MongoClient(uri);
    if (production) {
      const query = new URLSearchParams(uri.split('?')[1] ?? '');
      for (const [rawName, rawValue] of query) {
        const name = rawName.toLowerCase();
        const value = rawValue.toLowerCase();
        if (['tls', 'ssl'].includes(name) && ['false', '0'].includes(value)) throw new Error();
        if (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(name)
          && ['true', '1'].includes(value)) throw new Error();
        if (name === 'readpreference' && value !== 'primary') throw new Error();
        if (name === 'retrywrites' && value !== 'true') throw new Error();
        if (name === 'w' && value !== 'majority') throw new Error();
      }
      if (parsed.options.tls === false || parsed.options.tlsInsecure
        || parsed.options.tlsAllowInvalidCertificates || parsed.options.tlsAllowInvalidHostnames) throw new Error();
    }
  } catch {
    // Parser errors can contain credentials or private hosts. Expose only a fixed setting label.
    throw new ConfigurationError('MONGODB_URI', production
      ? 'use a valid MongoDB URI with verified TLS, primary reads, retryable writes, and majority acknowledgement.'
      : 'use a valid mongodb:// or mongodb+srv:// connection URI.');
  }
}

// Explicit input makes validation testable without reading anyone's .env.
export function readConfig(env) {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new ConfigurationError('NODE_ENV', 'use development, test, or production.');
  const production = mode === 'production';
  const publicAppOrigin = validatePublicAppOrigin(production ? required(env, 'PUBLIC_APP_ORIGIN') : env.PUBLIC_APP_ORIGIN ?? 'http://127.0.0.1:5173');
  if (production && !publicAppOrigin.startsWith('https://')) throw new ConfigurationError('PUBLIC_APP_ORIGIN', 'production requires your public HTTPS origin.');
  const host = env.HOST ?? '127.0.0.1';
  if (host !== host.trim() || (!isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))) throw new ConfigurationError('HOST', 'use a bind IP address or hostname.');
  const databaseName = production ? required(env, 'MONGODB_DB_NAME') : env.MONGODB_DB_NAME ?? 'card_codex';
  if (databaseName !== databaseName.trim() || databaseName.length > 64 || !/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new ConfigurationError('MONGODB_DB_NAME', 'use 1–64 letters, numbers, or underscores.');
  const mediaDriver = env.MEDIA_DRIVER ?? 'local';
  if (mediaDriver !== 'local') throw new ConfigurationError('MEDIA_DRIVER', 'only local is implemented; add an object-storage adapter before selecting it.');
  const allowLocalStorageInProduction = boolean(env, 'ALLOW_LOCAL_STORAGE_IN_PRODUCTION');
  const mediaDirectory = env.MEDIA_DIRECTORY || fileURLToPath(new URL('../storage/photos/', import.meta.url));
  if (production && !allowLocalStorageInProduction) throw new ConfigurationError('ALLOW_LOCAL_STORAGE_IN_PRODUCTION', 'local production storage requires explicit opt-in and a backed-up persistent volume.');
  if (production && (!env.MEDIA_DIRECTORY || !isAbsolute(mediaDirectory))) throw new ConfigurationError('MEDIA_DIRECTORY', 'set an absolute private persistent-volume path in production.');
  const mongoUri = production ? required(env, 'MONGODB_URI') : env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  validateMongoUri(mongoUri, production);
  const maxPoolSize = integer(env, 'MONGODB_MAX_POOL_SIZE', 5, 1, 100);
  const minPoolSize = integer(env, 'MONGODB_MIN_POOL_SIZE', 0, 0, 50);
  if (minPoolSize > maxPoolSize) throw new ConfigurationError('MONGODB_MIN_POOL_SIZE', 'must not exceed MONGODB_MAX_POOL_SIZE.');
  const configuration = {
    mode, production, host, port: integer(env, 'PORT', 3001, 1, 65535), publicAppOrigin,
    serveFrontend: production, mediaDriver, mediaDirectory, allowLocalStorageInProduction,
    databaseQueueLimit: integer(env, 'MONGODB_QUEUE_LIMIT', 10, 0, 100),
    httpSecurity: { production, publicOrigin: publicAppOrigin, trustProxy: proxyAddresses(env.TRUST_PROXY) },
    database: {
      uri: mongoUri,
      databaseName,
      maxPoolSize,
      minPoolSize,
      connectTimeoutMS: integer(env, 'MONGODB_CONNECT_TIMEOUT_MS', 3000, 500, 30000),
      serverSelectionTimeoutMS: integer(env, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 3000, 500, 30000),
      waitQueueTimeoutMS: integer(env, 'MONGODB_WAIT_QUEUE_TIMEOUT_MS', 1000, 100, 30000),
      timeoutMS: integer(env, 'MONGODB_OPERATION_TIMEOUT_MS', 3000, 500, 30000),
      maxIdleTimeMS: integer(env, 'MONGODB_MAX_IDLE_TIME_MS', 60000, 1000, 600000),
      readPreference: 'primary',
      retryWrites: true,
      writeConcern: { w: 'majority' },
      // Certificate and hostname checks use the driver's secure defaults.
      // Explicit tlsInsecure:false cannot be combined with the other TLS flags.
      ...(production ? { tls: true } : {}),
    },
  };
  try {
    const { uri, databaseName: _databaseName, ...options } = configuration.database;
    // Validate the effective application options too; driver URI options can
    // interact with enforced settings even when the URI parses on its own.
    new MongoClient(uri, options);
  } catch {
    throw new ConfigurationError('MONGODB_URI', 'use MongoDB options compatible with the application connection settings.');
  }
  return configuration;
}

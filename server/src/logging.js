const events = new Map([
  ['server_started', 'info'], ['dependency_check', 'info'],
  ['startup_failed', 'error'], ['fatal_error', 'error'],
  ['database_write_uncertain', 'error'],
  ['shutdown_started', 'info'], ['shutdown_complete', 'info'], ['shutdown_failed', 'error'], ['shutdown_timeout', 'error'],
]);
const reasons = new Set(['configuration', 'build_missing', 'port_in_use', 'startup', 'shutdown']);
const settings = new Set(['NODE_ENV', 'PORT', 'HOST', 'PUBLIC_APP_ORIGIN', 'TRUST_PROXY',
  'MONGODB_URI', 'MONGODB_DB_NAME', 'MONGODB_MAX_POOL_SIZE', 'MONGODB_MIN_POOL_SIZE',
  'MONGODB_CONNECT_TIMEOUT_MS', 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 'MONGODB_WAIT_QUEUE_TIMEOUT_MS',
  'MONGODB_OPERATION_TIMEOUT_MS', 'MONGODB_QUEUE_LIMIT', 'MONGODB_MAX_IDLE_TIME_MS',
  'MEDIA_DRIVER', 'MEDIA_DIRECTORY', 'ALLOW_LOCAL_STORAGE_IN_PRODUCTION']);

// Log known operational fields only. Never pass a request, URL, card, cookie,
// environment object, or database error to this logger.
export function createLogger(write = (line) => process.stdout.write(`${line}\n`)) {
  return (event, details = {}) => {
    if (!events.has(event)) return false;
    const entry = { timestamp: new Date().toISOString(), level: events.get(event), event };
    if (['development', 'test', 'production'].includes(details.mode)) entry.mode = details.mode;
    if (Number.isInteger(details.port) && details.port > 0 && details.port <= 65535) entry.port = details.port;
    if (typeof details.servesFrontend === 'boolean') entry.servesFrontend = details.servesFrontend;
    for (const field of ['database', 'storage']) {
      if (['available', 'unavailable'].includes(details[field])) entry[field] = details[field];
    }
    if (reasons.has(details.reason)) entry.reason = details.reason;
    if (settings.has(details.setting)) entry.setting = details.setting;
    try { write(JSON.stringify(entry)); return true; }
    catch { return false; }
  };
}

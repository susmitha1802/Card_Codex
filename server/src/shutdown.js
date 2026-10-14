// Stop accepting connections, let active requests finish, then close MongoDB.
// A deadline prevents a stuck request or pool from hanging a deployment.
export function registerShutdown({ server, pool, log, processObject = process, timeoutMs = 10000 }) {
  let stopping;
  let fatal = false;
  const onSignal = () => { void shutdown(); };
  const onFatal = () => { if (!fatal) log('fatal_error'); fatal = true; void shutdown(); };
  const onRequest = (_request, response) => {
    response.once('finish', () => {
      // Let Node mark this socket idle before closing its keep-alive connection.
      if (stopping) setImmediate(() => server.closeIdleConnections?.());
    });
  };
  server.on?.('request', onRequest);
  processObject.on('SIGINT', onSignal);
  processObject.on('SIGTERM', onSignal);
  processObject.on('uncaughtException', onFatal);
  processObject.on('unhandledRejection', onFatal);

  function detach() {
    server.removeListener?.('request', onRequest);
    for (const [name, listener] of [['SIGINT', onSignal], ['SIGTERM', onSignal],
      ['uncaughtException', onFatal], ['unhandledRejection', onFatal]]) processObject.removeListener(name, listener);
  }

  function shutdown() {
    if (stopping) return stopping;
    log('shutdown_started');
    stopping = new Promise((resolve) => {
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        detach();
        server.closeAllConnections?.();
        processObject.exitCode = 1;
        log('shutdown_timeout', { reason: 'shutdown' });
        resolve(false);
        processObject.exit(1);
      }, timeoutMs);
      server.close(async () => {
        try {
          if (typeof pool.close === 'function') await pool.close();
          else await pool.end();
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          detach();
          processObject.exitCode = fatal ? 1 : (processObject.exitCode ?? 0);
          log('shutdown_complete');
          resolve(true);
        } catch {
          // The deadline remains active if resource cleanup fails.
          log('shutdown_failed', { reason: 'shutdown' });
        }
      });
      server.closeIdleConnections?.();
    });
    return stopping;
  }

  return { shutdown, detach };
}

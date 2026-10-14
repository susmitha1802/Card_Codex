import { createLogger } from './logging.js';

const log = createLogger();
try {
  // Catch configuration/import failures as well as listen failures. No stack,
  // connection string, environment value, or raw database error is printed.
  const { startServer } = await import('./runtime.js');
  await startServer({ log });
} catch (error) {
  const reason = error.isConfigurationError ? 'configuration'
    : error.code === 'BUILD_NOT_FOUND' ? 'build_missing'
      : error.code === 'EADDRINUSE' ? 'port_in_use' : 'startup';
  log('startup_failed', { reason, setting: error.setting });
  process.exitCode = 1;
}

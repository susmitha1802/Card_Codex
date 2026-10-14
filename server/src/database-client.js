import { DatabaseAdmissionError } from './database-admission.js';

// Explicit connect() also retries an initial failed connection when Atlas later
// becomes available. The driver reuses an already connected client efficiently.
export function createDatabaseConnection(client, admission) {
  let closing;
  return {
    runDatabaseOperation(callback) {
      if (closing) return Promise.reject(new DatabaseAdmissionError('DATABASE_CLOSED', true));
      return admission.runDatabaseOperation(async (scope) => {
        try { await client.connect(); }
        catch (cause) {
          const error = new Error('The database connection is unavailable.', { cause });
          error.code = 'DATABASE_CONNECTION_UNAVAILABLE';
          error.safeToCleanupPhotos = true; // The actual operation never started.
          throw error;
        }
        scope.remainingMS();
        return callback(scope);
      });
    },
    closeDatabase() {
      if (!closing) closing = (async () => {
        await admission.close();
        await client.close();
      })();
      return closing;
    },
  };
}

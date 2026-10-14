import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStorage } from './local.js';

const publicDirectories = ['../../../client/public/', '../../../client/dist/']
  .map((value) => fileURLToPath(new URL(value, import.meta.url)));

export function assertStorageAdapter(adapter, { requireHealth = false } = {}) {
  const methods = ['write', 'read', 'remove', ...(requireHealth ? ['checkAvailability'] : [])];
  if (!adapter || methods.some((method) => typeof adapter[method] !== 'function')) {
    throw new Error('Storage must implement write, read, remove, and an availability check for runtime use.');
  }
  return adapter;
}

// Add a private object-storage implementation here later. Services receive an
// adapter, never a bucket URL or filesystem path.
export function createStorage({ driver = 'local', directory } = {}) {
  if (driver !== 'local') throw new Error('This storage driver has not been implemented.');
  if (directory) {
    const target = path.resolve(directory);
    for (const root of publicDirectories) {
      const relative = path.relative(root, target);
      const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
      if (!relative || !outside) {
        throw new Error('Photo storage must be outside public frontend directories.');
      }
    }
  }
  return assertStorageAdapter(createLocalStorage({ directory }), { requireHealth: true });
}

import { mkdir, open, lstat, realpath, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../../storage/photos/', import.meta.url));
const keyPattern = /^[A-Za-z0-9_-]{32}\.webp$/;

// Files stay outside the frontend's public directory. Routes decide whether a
// recipient is allowed to read them; the storage adapter never serves a URL.
export function createLocalStorage({ directory = defaultDirectory } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new Error('A photo storage directory is required.');
  }
  const rootDirectory = path.resolve(directory);
  const samePath = (left, right) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right;

  async function prepareDirectory(create = false) {
    // Check the nearest existing ancestor before creating folders. Symlinks or
    // junctions must not move private storage somewhere outside its chosen root.
    let ancestor = rootDirectory;
    while (true) {
      try {
        if (!samePath(await realpath(ancestor), ancestor)) throw new Error('Photo storage cannot use linked directories.');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    if (create) await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    if (!samePath(await realpath(rootDirectory), rootDirectory)) throw new Error('Photo storage cannot use linked directories.');
  }

  function filePath(key) {
    if (typeof key !== 'string' || key.length !== 37 || !keyPattern.test(key)) {
      throw new Error('Invalid photo storage key.');
    }
    const target = path.resolve(rootDirectory, key);
    const relative = path.relative(rootDirectory, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid photo storage key.');
    }
    return target;
  }

  const adapter = {
    async write(key, buffer) {
      const target = filePath(key);
      if (!Buffer.isBuffer(buffer)) throw new Error('Photo data must be a buffer.');
      await prepareDirectory(true);

      // Exclusive creation prevents an existing file from being overwritten.
      let handle;
      try {
        handle = await open(target, 'wx', 0o600);
        await handle.writeFile(buffer);
        await handle.close();
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
          await unlink(target).catch(() => {});
        }
        throw error;
      }
    },

    async read(key) {
      const target = filePath(key);
      await prepareDirectory();
      const before = await lstat(target);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid photo storage file.');
      const handle = await open(target, 'r');
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('Invalid photo storage file.');
        return await handle.readFile();
      } finally { await handle.close(); }
    },

    async remove(key) {
      try {
        await prepareDirectory();
        await unlink(filePath(key));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },

    async checkAvailability() {
      const key = `${randomBytes(24).toString('base64url')}.webp`;
      const bytes = Buffer.from('private-storage-availability-check');
      let written = false;
      try {
        try {
          await adapter.write(key, bytes);
          written = true;
          if (!(await adapter.read(key)).equals(bytes)) throw new Error();
        } finally { if (written) await adapter.remove(key); }
        return { available: true };
      } catch { throw new Error('Photo storage is unavailable.'); }
    },
  };
  return adapter;
}

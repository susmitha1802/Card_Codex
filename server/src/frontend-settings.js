import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import dotenv from 'dotenv';
import { normalizePublicOrigin } from '../../shared/shareLinks.js';

// Vite runs in Node. Read the same file as Express, returning only proxy settings.
// Never populate browser environment data or mutate process.env.
export function readFrontendSettings({
  envFile = new URL('../.env', import.meta.url), env = process.env,
} = {}) {
  let file = {};
  try { file = dotenv.parse(readFileSync(envFile)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read server environment configuration.');
  }
  const value = (key, fallback) => env[key] ?? file[key] ?? fallback;
  const origin = (key, fallback) => {
    try { return normalizePublicOrigin(value(key, fallback)); }
    catch { throw new Error(`Check ${key} in server configuration; use an HTTP(S) origin.`); }
  };
  const host = value('HOST', '127.0.0.1');
  const port = value('PORT', '3001');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Check PORT in server configuration; use a port from 1 to 65535.');
  }
  if (host !== host.trim() || (!isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))) {
    throw new Error('Check HOST in server configuration; use a bind IP address or hostname.');
  }
  // An all-interface bind address is not a destination for the local proxy.
  const proxyHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1'
    : isIP(host) === 6 ? `[${host}]` : host;
  return {
    apiTarget: origin('API_PROXY_TARGET', `http://${proxyHost}:${port}`),
    publicOrigin: origin('PUBLIC_APP_ORIGIN', 'http://127.0.0.1:5173'),
  };
}

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFrontendSettings } from '../src/frontend-settings.js';

function fixture(t, contents) {
  const directory = mkdtempSync(join(tmpdir(), 'emotale-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const envFile = join(directory, '.env');
  writeFileSync(envFile, contents);
  return envFile;
}

test('Vite shares backend address/origin without exporting secrets or mutating the environment', (t) => {
  const envFile = fixture(t, 'HOST=127.0.0.1\nPORT=4010\nPUBLIC_APP_ORIGIN=http://127.0.0.1:5183\nMONGODB_URI=mongodb://private-canary\nVITE_SECRET=private-canary\nNODE_ENV=development\n');
  const before = { ...process.env };
  assert.deepEqual(readFrontendSettings({ envFile, env: {} }), {
    apiTarget: 'http://127.0.0.1:4010', publicOrigin: 'http://127.0.0.1:5183',
  });
  assert.deepEqual({ ...process.env }, before);
});

test('hosting settings override file settings; wildcard and IPv6 binds use usable proxy addresses', (t) => {
  const envFile = fixture(t, 'PORT=4010\nPUBLIC_APP_ORIGIN=http://127.0.0.1:5183\n');
  for (const host of ['0.0.0.0', '::']) {
    assert.equal(readFrontendSettings({ envFile, env: { HOST: host, PORT: '4020' } }).apiTarget, 'http://127.0.0.1:4020');
  }
  assert.equal(readFrontendSettings({ envFile, env: { HOST: '::1' } }).apiTarget, 'http://[::1]:4010');
  assert.deepEqual(readFrontendSettings({ envFile, env: {
    API_PROXY_TARGET: 'https://api.example', PUBLIC_APP_ORIGIN: 'https://emotale.example',
  } }), { apiTarget: 'https://api.example', publicOrigin: 'https://emotale.example' });
});

test('missing local file uses defaults and invalid values produce secret-free errors', (t) => {
  const envFile = fixture(t, '');
  assert.deepEqual(readFrontendSettings({ envFile: envFile + '-missing', env: {} }), {
    apiTarget: 'http://127.0.0.1:3001', publicOrigin: 'http://127.0.0.1:5173',
  });
  for (const env of [{ PORT: '0' }, { PORT: '65536' }, { HOST: 'private-canary/path' },
    { API_PROXY_TARGET: 'https://user:private-canary@example.com' },
    { PUBLIC_APP_ORIGIN: 'https://example.com/private-canary' }]) {
    assert.throws(() => readFrontendSettings({ envFile, env }), (error) => !error.message.includes('private-canary'));
  }
});

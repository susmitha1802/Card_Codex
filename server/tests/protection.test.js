import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { createCardsService } from '../src/services/cards.js';
import { hashSecretCode, verifySecretCode } from '../src/security/secret-codes.js';
import { publicHintsFromRow, validateCardInput } from '../src/validation/cards.js';

const input = {
  occasion: 'love', theme: 'romantic', title: 'A private note',
  recipientName: 'Alex', message: 'Only you should see this message.',
  font: 'serif', fontSize: 'large', alignment: 'left', textColor: '#ab12ef',
};
const code = 'Meet me at 8!';
const token = 'A'.repeat(32);
const sharedHash = await hashSecretCode(code);
const failure = { error: 'We could not unlock this card. Please check the code and try again.' };

function row(overrides = {}) {
  return {
    ...input, recipient_name: input.recipientName,
    customization: { font: input.font, fontSize: input.fontSize, alignment: input.alignment, textColor: input.textColor },
    unlock_code_hash: sharedHash, unlock_hints: [], status: 'active',
    ...overrides,
  };
}

function memoryRepository(initialRows = []) {
  const rows = new Map(initialRows);
  const reads = { protection: 0, public: 0, content: 0 };
  function available(shareToken) {
    const value = rows.get(shareToken);
    return value && value.status === 'active'
      && (!value.expires_at || new Date(value.expires_at).getTime() > Date.now()) ? value : null;
  }
  return {
    rows, reads,
    async insert(card, shareToken) {
      rows.set(shareToken, {
        ...card, recipient_name: card.recipientName, unlock_code_hash: card.codeHash,
        unlock_hints: card.codeHash ? card.hints : null, status: 'active',
      });
    },
    async findProtectionByToken(shareToken) {
      reads.protection += 1;
      const value = available(shareToken);
      return value ? { unlock_code_hash: value.unlock_code_hash, unlock_hints: value.unlock_hints } : null;
    },
    async findPublicByToken(shareToken) {
      reads.public += 1;
      const value = available(shareToken);
      return value?.unlock_code_hash === null ? value : null;
    },
    async findContentByToken(shareToken) {
      reads.content += 1;
      return available(shareToken);
    },
  };
}

async function withServer(repository, run, cardsOptions = {}) {
  const app = createApp({ checkDatabase: async () => {}, cardsRepository: repository, cardsOptions });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
}

function post(url, path, body, headers = {}) {
  return fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function unlock(url, shareToken = token, enteredCode = code, headers = {}) {
  return post(url, `/api/cards/${shareToken}/unlock`, { code: enteredCode }, headers);
}

function unlockFromIp(url, ip, shareToken = token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ code: 'Wrong code!' });
    const request = httpRequest(new URL(`/api/cards/${shareToken}/unlock`, url), {
      method: 'POST', localAddress: ip,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('normal cards default to no protection and disabled values are not stored', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    for (const protection of [undefined, { enabled: false }, { enabled: false, code, hints: ['Unused'] }]) {
      const response = await post(url, '/api/cards', { ...input, ...(protection ? { protection } : {}) });
      assert.equal(response.status, 201);
      const { shareToken } = await response.json();
      const stored = repository.rows.get(shareToken);
      assert.equal(stored.unlock_code_hash, null);
      assert.equal(stored.unlock_hints, null);
      assert.equal(Object.hasOwn(stored, 'protection'), false);
      const loaded = await fetch(`${url}/api/cards/${shareToken}`);
      assert.deepEqual(await loaded.json(), { card: input });
    }
  });
});

test('protected cards accept zero, one, or two intentional public hints', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    const tokens = new Set();
    for (const hints of [[], ['Where we met'], ['Where we met', 'A special evening']]) {
      const response = await post(url, '/api/cards', { ...input, protection: { enabled: true, code, hints } });
      assert.equal(response.status, 201);
      const created = await response.json();
      assert.deepEqual(Object.keys(created).sort(), ['cardPath', 'shareToken']);
      tokens.add(created.shareToken);
      const stored = repository.rows.get(created.shareToken);
      assert.match(stored.unlock_code_hash, /^scrypt\$v1\$/);
      assert.deepEqual(stored.unlock_hints, hints);
      assert.ok(!JSON.stringify(stored).includes(code));
      assert.equal(Object.hasOwn(stored, 'protection'), false);
      const locked = await fetch(`${url}/api/cards/${created.shareToken}`);
      assert.equal(locked.status, 200);
      assert.equal(locked.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await locked.json(), { protection: { enabled: true, hints } });
    }
    assert.equal(tokens.size, 3);
    assert.equal(repository.reads.public, 0);
    assert.equal(repository.reads.content, 0);
  });
});

test('enabled codes must be nonblank text with 8 to 128 Unicode characters', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    for (const value of [undefined, null, '', '        ', '1234567', 'a'.repeat(129), '1234567\ud800', 12345678, {}, []]) {
      const response = await post(url, '/api/cards', { ...input, protection: { enabled: true, code: value } });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).fields.code, 'string');
    }
    assert.equal(repository.rows.size, 0);
  });
  for (const value of ['a'.repeat(8), 'a'.repeat(128), '😀'.repeat(8), '😀'.repeat(128)]) {
    assert.equal(validateCardInput({ ...input, protection: { enabled: true, code: value } }).valid, true);
  }
  assert.equal(validateCardInput({ ...input, protection: { enabled: true, code: '😀'.repeat(7) } }).valid, false);
});

test('protection and hints reject invalid types, excessive lengths, and unknown fields', async () => {
  const invalid = [
    null, true, [], 'enabled', {}, { enabled: 'true' },
    { enabled: false, hash: 'caller-controlled' },
    { enabled: true, code, extra: 'unknown' },
    ...[null, 'hint', {}, ['a', 'b', 'c'], [1], [null], ['a'.repeat(201)]]
      .map((hints) => ({ enabled: true, code, hints })),
  ];
  for (const protection of invalid) {
    assert.equal(validateCardInput({ ...input, protection }).valid, false, JSON.stringify(protection));
  }
  const validated = validateCardInput({
    ...input, protection: { enabled: true, code, hints: ['  Where we met  ', '   '] },
  });
  assert.deepEqual(validated.card.protection.hints, ['Where we met']);
  assert.equal(validated.card.protection.code, code);
  assert.equal(validateCardInput({ ...input, protection: { enabled: true, code, hints: ['x'.repeat(200)] } }).valid, true);
});

test('wrong codes fail before content is queried and correct codes return only public fields', async () => {
  const repository = memoryRepository([[token, row({ id: 42, created_at: 'private timestamp' })]]);
  await withServer(repository, async (url) => {
    const wrong = await unlock(url, token, 'Wrong code!');
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), failure);
    assert.equal(repository.reads.content, 0);
    const correct = await unlock(url);
    assert.equal(correct.status, 200);
    assert.equal(correct.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await correct.json(), { card: input });
    assert.equal(repository.reads.content, 1);
    const refreshed = await fetch(`${url}/api/cards/${token}`);
    assert.deepEqual(await refreshed.json(), { protection: { enabled: true, hints: [] } });
  });
});

test('invalid, absent, inactive, expired, and damaged-hash cards fail with the same response', async () => {
  const repository = memoryRepository([
    [token, row()],
    ['B'.repeat(32), row({ status: 'inactive' })],
    ['C'.repeat(32), row({ expires_at: '2000-01-01T00:00:00Z' })],
    ['D'.repeat(32), row({ unlock_code_hash: 'damaged' })],
  ]);
  await withServer(repository, async (url) => {
    for (const [shareToken, enteredCode] of [
      ['invalid', code], ['Z'.repeat(32), code], ['B'.repeat(32), code],
      ['C'.repeat(32), code], ['D'.repeat(32), code], [token, 'Wrong code!'],
    ]) {
      const response = await unlock(url, shareToken, enteredCode);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), failure);
    }
    for (const shareToken of ['invalid', 'Z'.repeat(32), 'B'.repeat(32), 'C'.repeat(32)]) {
      const response = await fetch(`${url}/api/cards/${shareToken}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "This card couldn't be found." });
    }
    const damaged = await fetch(`${url}/api/cards/${'D'.repeat(32)}`);
    assert.deepEqual(await damaged.json(), { protection: { enabled: true, hints: [] } });
    assert.equal(repository.reads.content, 0);
  });
});

test('malformed unlock requests receive a generic failure before any database read', async () => {
  const repository = memoryRepository([[token, row()]]);
  await withServer(repository, async (url) => {
    for (const body of [null, [], {}, { code: '' }, { code: 'short' }, { code: 12345678 }, { code, extra: true }]) {
      const response = await post(url, `/api/cards/${token}/unlock`, body);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), failure);
    }
    assert.equal(repository.reads.protection, 0);
  }, { unlockLimits: { perCardMax: 20 } });
});

test('legacy unprotected cards still open immediately with default appearance', async () => {
  const repository = memoryRepository([[token, row({
    unlock_code_hash: null, unlock_hints: null, customization: null,
  })]]);
  await withServer(repository, async (url) => {
    const response = await fetch(`${url}/api/cards/${token}`);
    assert.equal(response.status, 200);
    const expected = { ...input, font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null };
    assert.deepEqual(await response.json(), { card: expected });
    assert.deepEqual(await (await unlock(url, token, 'Any code here')).json(), { card: expected });
    assert.equal(repository.reads.content, 0);
  });
});

test('unlock database failures stay private and remain retryable', async () => {
  await withServer({
    async findProtectionByToken() { throw new Error(`private MongoDB URI ${code}`); },
  }, async (url) => {
    const response = await unlock(url);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'We could not unlock this card right now. Please try again.' });
  });
  await withServer({
    async findProtectionByToken() { return { unlock_code_hash: sharedHash }; },
    async findContentByToken() { throw new Error('private database details'); },
  }, async (url) => {
    const response = await unlock(url);
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify(await response.json()).includes('private'));
  });
});

test('hashes use independent salts, preserve exact codes, and reject malformed encodings', async () => {
  const exactCode = '  Meet Me 😀  ';
  const first = await hashSecretCode(exactCode);
  const second = await hashSecretCode(exactCode);
  assert.notEqual(first, second);
  assert.ok(first.length <= 255);
  assert.ok(!first.includes(exactCode));
  assert.equal(await verifySecretCode(exactCode, first), true);
  assert.equal(await verifySecretCode(exactCode.trim(), first), false);
  assert.equal(await verifySecretCode(exactCode.toLowerCase(), first), false);
  for (const malformed of [null, '', 'scrypt$v2$65536$8$2$bad$bad', first.replace('65536', '1073741824'), `${first}extra`]) {
    assert.equal(await verifySecretCode(exactCode, malformed), false);
  }
});

test('plaintext codes never reach storage, responses, or application logs', async (t) => {
  const logs = [];
  for (const method of ['log', 'info', 'warn', 'error']) {
    t.mock.method(console, method, (...arguments_) => logs.push(arguments_.map(String).join(' ')));
  }
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    const createdResponse = await post(url, '/api/cards', { ...input, protection: { enabled: true, code } });
    const created = await createdResponse.json();
    const locked = await (await fetch(`${url}/api/cards/${created.shareToken}`)).json();
    const failed = await (await unlock(url, created.shareToken, 'Wrong code!')).json();
    const successful = await (await unlock(url, created.shareToken)).json();
    const all = JSON.stringify([created, locked, failed, successful, [...repository.rows.values()], logs]);
    assert.ok(!all.includes(code));
    assert.ok(!JSON.stringify([created, locked, failed, successful]).includes('scrypt$'));
  });
});

test('the sixth failed attempt is blocked before database or hash work and includes retry guidance', async () => {
  const repository = memoryRepository([[token, row()]]);
  await withServer(repository, async (url) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await unlock(url, token, 'Wrong code!')).status, 401);
    }
    const response = await unlock(url);
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.error, 'Too many attempts. Please try again later.');
    assert.ok(body.retryAfterSeconds > 0 && body.retryAfterSeconds <= 900);
    assert.equal(Number(response.headers.get('retry-after')), body.retryAfterSeconds);
    assert.ok(response.headers.get('ratelimit'));
    assert.equal(repository.reads.protection, 5);
    assert.equal(repository.reads.content, 0);
  });
});

test('successful unlocks do not consume the failed-attempt quota', async () => {
  const repository = memoryRepository([[token, row({ unlock_code_hash: null })]]);
  await withServer(repository, async (url) => {
    for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await unlock(url)).status, 200);
    assert.equal((await unlock(url, token, 'short')).status, 401);
    assert.equal((await unlock(url)).status, 200);
    assert.equal((await unlock(url, token, 'short')).status, 401);
    assert.equal((await unlock(url)).status, 429);
  }, { unlockLimits: { perCardMax: 2 } });
});

test('the failed-attempt quota resets after its configured window', async () => {
  const repository = memoryRepository([[token, row()]]);
  await withServer(repository, async (url) => {
    // Short invalid codes exercise the limiter without an expensive hash compare.
    assert.equal((await unlock(url, token, 'short')).status, 401);
    assert.equal((await unlock(url, token, 'short')).status, 429);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await unlock(url, token, 'short')).status, 401);
  }, { unlockLimits: { windowMs: 100, perCardMax: 1 } });
});

test('the per-IP quota covers attempts across different cards', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    assert.equal((await unlock(url, 'A'.repeat(32), 'short')).status, 401);
    assert.equal((await unlock(url, 'B'.repeat(32), 'short')).status, 401);
    assert.equal((await unlock(url, 'C'.repeat(32), 'short')).status, 429);
    assert.equal(repository.reads.protection, 0);
  }, { unlockLimits: { perIpMax: 2 } });
});

test('different connection IPs have independent quotas while forwarded headers cannot bypass them', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    assert.equal((await unlockFromIp(url, '127.0.0.1')).status, 401);
    assert.equal((await unlockFromIp(url, '127.0.0.1')).status, 429);
    assert.equal((await unlockFromIp(url, '127.0.0.2')).status, 401);
    const forged = await unlock(url, token, 'Wrong code!', {
      'X-Forwarded-For': '192.0.2.123', Forwarded: 'for=192.0.2.123',
    });
    assert.equal(forged.status, 429);
  }, { unlockLimits: { perCardMax: 1 } });
});

test('protected creation is bounded before expensive work while normal creation remains unchanged', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    const protectedInput = { ...input, protection: { enabled: true, code } };
    assert.equal((await post(url, '/api/cards', protectedInput)).status, 201);
    assert.equal((await post(url, '/api/cards', protectedInput)).status, 429);
    assert.equal((await post(url, '/api/cards', input)).status, 201);
    assert.equal(repository.rows.size, 2);
  }, { creationLimit: { max: 1 } });
});

test('token collision retries reuse one hash and never pass a plaintext code to the repository', async () => {
  const storedHashes = [];
  const collision = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  const service = createCardsService({
    async insert(stored) {
      assert.equal(Object.hasOwn(stored, 'protection'), false);
      assert.ok(!JSON.stringify(stored).includes(code));
      storedHashes.push(stored.codeHash);
      if (storedHashes.length < 3) throw collision;
    },
  });
  await service.create(validateCardInput({ ...input, protection: { enabled: true, code } }).card);
  assert.equal(storedHashes.length, 3);
  assert.equal(new Set(storedHashes).size, 1);
});

test('MongoDB stores only hash and hints and separates protection metadata from card content', async () => {
  const calls = [];
  const document = row();
  const repository = createCardsRepository({ collection(name) {
    return {
      async insertOne(value) { calls.push({ operation: 'insertOne', name, value }); },
      async findOne(filter, options) {
        calls.push({ operation: 'findOne', name, filter, options });
        return document;
      },
    };
  } }, {}, { assertSchemaReady: async () => {} });
  const validated = validateCardInput({ ...input, protection: { enabled: true, code, hints: ['A memory'] } }).card;
  const { protection: _protection, ...content } = validated;
  await repository.insert({ ...content, codeHash: sharedHash, hints: ['A memory'] }, token);
  assert.equal(calls[0].value.unlock_code_hash, sharedHash);
  assert.deepEqual(calls[0].value.unlock_hints, ['A memory']);
  assert.ok(!JSON.stringify(calls[0]).includes(code));
  await repository.findProtectionByToken(token);
  await repository.findPublicByToken(token);
  await repository.findContentByToken(token);
  assert.deepEqual(calls[1].options.projection, { _id: 0, unlock_code_hash: 1, unlock_hints: 1 });
  assert.deepEqual(calls[2].options.projection, {
    _id: 0, occasion: 1, title: 1, message: 1, recipient_name: 1, theme: 1, customization: 1,
  });
  assert.deepEqual(calls[3].options.projection, calls[2].options.projection);
  assert.ok(JSON.stringify(calls[2].filter.$expr).includes('$$NOW'));
  assert.ok(JSON.stringify(calls[2].filter.$expr).includes('active'));
  assert.deepEqual(calls[2].filter.unlock_code_hash, { $type: 'null' });
  assert.deepEqual(calls[1].filter.unlock_code_hash, { $type: ['string', 'null'] });
  for (const field of ['_id', 'media', 'legacy_mysql_id', 'share_token', 'storage_key']) {
    assert.notEqual(calls[1].options.projection[field], 1);
  }
  assert.ok(!Object.hasOwn(calls[2].options.projection, 'unlock_code_hash'));
});

test('stored hint parsing drops malformed or excessive data instead of exposing arbitrary JSON', () => {
  assert.deepEqual(publicHintsFromRow('not JSON'), []);
  assert.deepEqual(publicHintsFromRow('{"code":"private"}'), []);
  assert.deepEqual(publicHintsFromRow('["  A memory  ", 7, "", "Second", "Third"]'), ['A memory', 'Second']);
  assert.deepEqual(publicHintsFromRow(['x'.repeat(201)]), []);
});

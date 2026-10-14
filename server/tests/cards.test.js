import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createCardsRepository } from '../src/repositories/cards.js';
import { createCardsService } from '../src/services/cards.js';
import { validateCardInput } from '../src/validation/cards.js';

const minimalCard = { occasion: 'birthday', message: 'Happy birthday!\nWishing you a lovely day.', theme: 'birthday' };

function memoryRepository() {
  const rows = new Map();
  return {
    rows,
    async insert(card, shareToken) {
      rows.set(shareToken, {
        ...card,
        recipient_name: card.recipientName,
        id: 99,
        share_token: shareToken,
        status: 'active',
        created_at: 'internal timestamp',
        unlock_code_hash: card.codeHash,
        unlock_hints: card.hints,
      });
    },
    async findPublicByToken(shareToken) {
      const row = rows.get(shareToken);
      return row?.unlock_code_hash === null ? row : null;
    },
    async findProtectionByToken(shareToken) {
      const row = rows.get(shareToken);
      return row ? { unlock_code_hash: row.unlock_code_hash, unlock_hints: row.unlock_hints } : null;
    },
    async findContentByToken(shareToken) {
      return rows.get(shareToken) ?? null;
    },
  };
}

async function withServer(repository, run) {
  const server = createApp({ checkDatabase: async () => {}, cardsRepository: repository }).listen(0, '127.0.0.1');
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

function postCard(url, body) {
  return fetch(`${url}/api/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a minimal card saves once and can be loaded using its unpredictable token', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    const created = await postCard(url, minimalCard);
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.deepEqual(Object.keys(result).sort(), ['cardPath', 'shareToken']);
    assert.match(result.shareToken, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(result.cardPath, `/card/${result.shareToken}`);
    assert.equal(repository.rows.size, 1);
    assert.equal(repository.rows.get(result.shareToken).title, null);
    assert.equal(repository.rows.get(result.shareToken).recipient_name, null);

    const response = await fetch(`${url}/api/cards/${result.shareToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      card: {
        ...minimalCard,
        title: '',
        recipientName: '',
        font: 'theme',
        fontSize: 'medium',
        alignment: 'center',
        textColor: null,
      },
    });
  });
});

test('two cards receive different tokens and appearance values round trip', async () => {
  const repository = memoryRepository();
  const input = {
    ...minimalCard,
    occasion: 'love',
    theme: 'romantic',
    recipientName: '  Alex  ',
    title: '  A note for you  ',
    message: '  First line\n\nSecond line 💌  ',
    font: 'handwritten',
    fontSize: 'large',
    alignment: 'left',
    textColor: '#AB12EF',
  };
  await withServer(repository, async (url) => {
    const first = await (await postCard(url, input)).json();
    const second = await (await postCard(url, input)).json();
    assert.notEqual(first.shareToken, second.shareToken);
    assert.equal(repository.rows.size, 2);
    const response = await fetch(`${url}/api/cards/${first.shareToken}`);
    assert.deepEqual((await response.json()).card, {
      ...input,
      recipientName: 'Alex',
      title: 'A note for you',
      textColor: '#ab12ef',
    });
  });
});

test('invalid card fields are rejected before the repository is called', async () => {
  let inserts = 0;
  const repository = { insert: async () => { inserts += 1; }, findPublicByToken: async () => null };
  const invalidFields = [
    ['occasion', 'unknown'], ['occasion', null], ['theme', 'unknown'], ['font', 'unsafe-font'],
    ['fontSize', 24], ['fontSize', 'huge'], ['alignment', 'justify'],
    ['textColor', 'red'], ['textColor', '#fff'], ['textColor', 'url(private)'],
    ['title', {}], ['title', 'a'.repeat(201)],
    ['recipientName', 12], ['recipientName', 'a'.repeat(101)],
    ['message', ' \n '], ['message', null], ['message', 'a'.repeat(10001)],
  ];
  await withServer(repository, async (url) => {
    for (const [field, value] of invalidFields) {
      const response = await postCard(url, { ...minimalCard, [field]: value });
      assert.equal(response.status, 400, `invalid ${field}`);
      const body = await response.json();
      assert.equal(body.error, 'Please check your card details.');
      assert.equal(typeof body.fields[field], 'string');
    }
    for (const body of [null, [], 'text']) {
      const response = await postCard(url, body);
      assert.equal(response.status, 400);
    }
    assert.equal(inserts, 0);
  });
});

test('arbitrary customization and server-controlled fields are rejected', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    for (const field of ['customization', 'id', 'shareToken', 'status', 'unlock_code_hash', 'unlockHints']) {
      const response = await postCard(url, { ...minimalCard, [field]: { unexpected: 'value' } });
      assert.equal(response.status, 400, field);
      assert.equal(typeof (await response.json()).fields.details, 'string');
    }
    assert.equal(repository.rows.size, 0);
  });
});

test('boundary lengths work and messages remain plain text with exact line breaks', () => {
  const input = {
    ...minimalCard,
    title: 'a'.repeat(200),
    recipientName: 'a'.repeat(100),
    message: '<script>hello</script>\n' + 'a'.repeat(9977),
  };
  assert.equal(input.message.length, 10000);
  const result = validateCardInput(input);
  assert.equal(result.valid, true);
  assert.equal(result.card.message, input.message);
  assert.equal(validateCardInput({ ...input, message: 'a'.repeat(10000) }).valid, true);
});

test('invalid and missing share tokens produce the same friendly 404', async () => {
  let reads = 0;
  const repository = { insert: async () => {}, findProtectionByToken: async () => { reads += 1; return null; } };
  await withServer(repository, async (url) => {
    for (const token of ['invalid', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(32)]) {
      const response = await fetch(`${url}/api/cards/${token}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "This card couldn't be found." });
    }
    assert.equal(reads, 1);
  });
});

test('public output drops internal fields and unknown customization keys', async () => {
  const repository = memoryRepository();
  const token = 'A'.repeat(32);
  repository.rows.set(token, {
    ...minimalCard,
    title: null,
    recipient_name: null,
    customization: JSON.stringify({ font: 'serif', fontSize: 'huge', textColor: 'red', secretCode: 'private' }),
    id: 42,
    unlock_code_hash: null,
    unlock_hints: ['private'],
    created_at: 'private',
  });
  await withServer(repository, async (url) => {
    const response = await fetch(`${url}/api/cards/${token}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.card).sort(), [
      'alignment', 'font', 'fontSize', 'message', 'occasion', 'recipientName', 'textColor', 'theme', 'title',
    ]);
    assert.equal(body.card.font, 'serif');
    assert.equal(body.card.fontSize, 'medium');
    assert.equal(body.card.textColor, null);
    assert.ok(!JSON.stringify(body).includes('private'));
  });
});

test('database errors stay private and produce a retryable response', async () => {
  const repository = {
    insert: async () => { throw new Error('private MongoDB URI'); },
    findProtectionByToken: async () => { throw new Error('private MongoDB URI'); },
  };
  await withServer(repository, async (url) => {
    const responses = [await postCard(url, minimalCard), await fetch(`${url}/api/cards/${'A'.repeat(32)}`)];
    for (const response of responses) {
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /Please try again/);
      assert.ok(!JSON.stringify(body).includes('private'));
    }
  });
});

test('malformed JSON, oversized bodies, and non-JSON submissions never reach storage', async () => {
  const repository = memoryRepository();
  await withServer(repository, async (url) => {
    const malformed = await fetch(`${url}/api/cards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken-json',
    });
    assert.equal(malformed.status, 400);
    assert.ok(!JSON.stringify(await malformed.json()).includes('SyntaxError'));

    const oversized = await postCard(url, { ...minimalCard, message: 'x'.repeat(70000) });
    assert.equal(oversized.status, 413);
    assert.equal(typeof (await oversized.json()).error, 'string');

    const wrongType = await fetch(`${url}/api/cards`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(minimalCard),
    });
    assert.equal(wrongType.status, 415);
    assert.equal(repository.rows.size, 0);
  });
});

test('a rare token collision is retried, with a limit of three attempts', async () => {
  const card = validateCardInput(minimalCard).card;
  const tokens = ['A'.repeat(32), 'B'.repeat(32), 'C'.repeat(32)];
  let attempts = 0;
  const collision = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  const service = createCardsService({
    async insert(_card, token) {
      attempts += 1;
      assert.equal(token, tokens[attempts - 1]);
      if (attempts < 3) throw collision;
    },
  }, { generateShareToken: () => tokens[attempts] });
  assert.equal((await service.create(card)).shareToken, tokens[2]);
  assert.equal(attempts, 3);

  attempts = 0;
  const exhausted = createCardsService({ insert: async () => { attempts += 1; throw collision; } });
  await assert.rejects(exhausted.create(card), { code: 'ER_DUP_ENTRY' });
  assert.equal(attempts, 3);

  attempts = 0;
  const unavailable = createCardsService({ insert: async () => { attempts += 1; throw new Error('unavailable'); } });
  await assert.rejects(unavailable.create(card), /unavailable/);
  assert.equal(attempts, 1);
});

test('MongoDB repository inserts complete card documents and projects only public card fields', async () => {
  const calls = [];
  const row = { occasion: 'birthday' };
  const now = new Date('2026-10-06T12:00:00.000Z');
  const id = new ObjectId();
  const database = { collection(name) {
    return {
      async insertOne(document) { calls.push({ operation: 'insertOne', name, document }); },
      async findOne(filter, options) { calls.push({ operation: 'findOne', name, filter, options }); return row; },
    };
  } };
  const repository = createCardsRepository(database, {}, { now: () => now, makeId: () => id, assertSchemaReady: async () => {} });
  const card = validateCardInput({ ...minimalCard, message: "It's a card; DROP TABLE cards;" }).card;
  const token = 'A'.repeat(32);
  await repository.insert(card, token);
  assert.equal(calls[0].operation, 'insertOne');
  assert.equal(calls[0].name, 'cards');
  assert.deepEqual(calls[0].document, {
    _id: id, schema_version: 1,
    share_token: token, occasion: card.occasion, title: null, message: card.message,
    recipient_name: null, theme: card.theme, customization: card.customization,
    unlock_code_hash: null, unlock_hints: null, status: 'active',
    created_at: now, updated_at: now,
    expires_at: null, media: [],
  });

  assert.deepEqual(await repository.findPublicByToken(token), row);
  assert.equal(calls[1].filter.share_token, token);
  assert.deepEqual(calls[1].filter.unlock_code_hash, { $type: 'null' });
  assert.ok(JSON.stringify(calls[1].filter.$expr).includes('$$NOW'));
  assert.ok(JSON.stringify(calls[1].filter.$expr).includes('active'));
  assert.ok(!JSON.stringify(calls[1].filter).includes(now.toISOString()));
  assert.deepEqual(calls[1].options.projection, {
    _id: 0, occasion: 1, title: 1, message: 1, recipient_name: 1, theme: 1, customization: 1,
  });
  assert.deepEqual(calls[1].options.collation, { locale: 'simple' });
  assert.ok(!Object.hasOwn(calls[1].options.projection, 'unlock_code_hash'));
});

test('MongoDB duplicate-key errors preserve the existing share-token retry contract', async () => {
  const id = new ObjectId();
  const token = 'A'.repeat(32);
  const repository = createCardsRepository({ collection() {
    return {
      async insertOne() {
        throw Object.assign(new Error('duplicate MongoDB key'), { code: 11000,
          keyPattern: { share_token: 1 }, keyValue: { share_token: token } });
      },
      async findOne(filter) { return filter._id instanceof ObjectId ? null : { _id: new ObjectId() }; },
    };
  } }, {}, { makeId: () => id, assertSchemaReady: async () => {} });
  const card = validateCardInput(minimalCard).card;
  await assert.rejects(repository.insert({
    occasion: card.occasion, title: null, recipientName: null, message: card.message,
    theme: card.theme, customization: card.customization, codeHash: null,
  }, token), { code: 'ER_DUP_ENTRY', safeToCleanupPhotos: true });
});

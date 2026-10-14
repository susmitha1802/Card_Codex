import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { publicCardFromRow, validateCardInput } from '../src/validation/cards.js';
import { DESIGN_DEFAULTS } from '../../shared/designOptions.js';

const basic = { occasion: 'love', theme: 'romantic', message: 'Every little memory matters.' };
const customized = {
  background: 'rose', layout: 'letter', photoLayout: 'stacked',
  textWeight: 'bold', lineSpacing: 'airy', decorations: 'hearts',
};

function memoryRepository() {
  const rows = new Map();
  let contentReads = 0;
  return {
    rows,
    get contentReads() { return contentReads; },
    async insert(card, token) {
      rows.set(token, { ...card, recipient_name: card.recipientName,
        unlock_code_hash: card.codeHash, unlock_hints: card.hints });
    },
    async findProtectionByToken(token) {
      const row = rows.get(token);
      return row ? { unlock_code_hash: row.unlock_code_hash, unlock_hints: row.unlock_hints } : null;
    },
    async findPublicByToken(token) {
      contentReads += 1;
      const row = rows.get(token);
      return row?.unlock_code_hash === null ? row : null;
    },
    async findContentByToken(token) { contentReads += 1; return rows.get(token) ?? null; },
  };
}

async function withServer(run) {
  const repository = memoryRepository();
  const server = createApp({ checkDatabase: async () => {}, cardsRepository: repository }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`, repository);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
}

function post(url, body, path = '/api/cards') {
  return fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('absent, empty, and default designs preserve the legacy stored and public shape', async () => {
  await withServer(async (url, repository) => {
    for (const design of [undefined, {}, { ...DESIGN_DEFAULTS }]) {
      const response = await post(url, { ...basic, ...(design === undefined ? {} : { design }) });
      assert.equal(response.status, 201);
      const { shareToken } = await response.json();
      assert.deepEqual(repository.rows.get(shareToken).customization, {
        font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null,
      });
      const loaded = await (await fetch(`${url}/api/cards/${shareToken}`)).json();
      assert.deepEqual(loaded, { card: {
        ...basic, title: '', recipientName: '', font: 'theme', fontSize: 'medium', alignment: 'center', textColor: null,
      } });
    }
  });
});

test('a complete design round trips without duplicating font settings or storing default sticker appearance', async () => {
  await withServer(async (url, repository) => {
    const stickers = [
      { id: 'heart', position: 'top-left', size: 'large', rotation: -15 },
      { id: 'rose', position: 'bottom-right', size: 'medium', rotation: 0 },
    ];
    const input = { ...basic, recipientName: 'Alex', title: 'A favorite memory', font: 'rounded',
      fontSize: 'large', alignment: 'left', textColor: '#123ABC', design: customized, stickers };
    const response = await post(url, input);
    assert.equal(response.status, 201);
    const { shareToken } = await response.json();
    const stored = repository.rows.get(shareToken);
    assert.equal(Object.hasOwn(stored, 'design'), false);
    assert.equal(Object.hasOwn(stored, 'stickers'), false);
    assert.deepEqual(stored.customization.design, customized);
    assert.deepEqual(stored.customization.stickers, [
      stickers[0], { id: 'rose', position: 'bottom-right' },
    ]);
    assert.deepEqual(await (await fetch(`${url}/api/cards/${shareToken}`)).json(), { card: {
      ...input, textColor: '#123abc', stickers: stored.customization.stickers,
    } });
  });
});

test('partial designs use existing defaults and store only changed values', () => {
  const input = { ...basic, design: { background: 'cream', layout: 'centered', photoLayout: 'gallery', decorations: 'none' } };
  const result = validateCardInput(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.card.customization.design, { background: 'cream' });
  assert.deepEqual(publicCardFromRow({ ...basic, customization: result.card.customization }).design, { background: 'cream' });
  assert.equal(Object.hasOwn(validateCardInput({ ...basic, design: { textWeight: 'normal' } }).card.customization, 'design'), false);
});

test('the API rejects malformed design containers, unknown keys, arbitrary URLs, CSS and HTML before storage', async () => {
  const invalid = [
    null, [], 'rose', 123, false,
    { unknown: 'value' }, { style: 'color:red' }, { font: 'serif' },
    { background: 'url(https://example.invalid/private.jpg)' },
    { background: '<script>alert(1)</script>' }, { background: '#ff00ff' },
    { layout: 'position:absolute' }, { photoLayout: 'unbounded-collage' },
    { textWeight: 700 }, { lineSpacing: 2 }, { decorations: '<svg onload=alert(1)>' },
    { background: null }, { layout: [] }, { decorations: {} },
    JSON.parse('{"__proto__":{"background":"rose"}}'),
  ];
  await withServer(async (url, repository) => {
    for (const design of invalid) {
      const response = await post(url, { ...basic, design });
      assert.equal(response.status, 400, JSON.stringify(design));
      const body = await response.json();
      assert.equal(typeof body.fields.design, 'string');
      assert.ok(!JSON.stringify(body).includes('example.invalid'));
      assert.ok(!JSON.stringify(body).includes('<script>'));
      assert.ok(!JSON.stringify(body).includes('<svg'));
    }
    assert.equal(repository.rows.size, 0);
  });
});

test('every design field validates its own enum and accepts no whitespace or mixed types', () => {
  const fields = ['background', 'layout', 'photoLayout', 'textWeight', 'lineSpacing', 'decorations'];
  for (const field of fields) {
    for (const value of ['unknown', '', ` ${DESIGN_DEFAULTS[field]} `, true, 0, [], {}]) {
      const result = validateCardInput({ ...basic, design: { [field]: value } });
      assert.equal(result.valid, false, `${field}:${JSON.stringify(value)}`);
      assert.equal(typeof result.fields.design, 'string');
    }
  }
});

test('sticker size and rotation remain bounded, optional, and compatible with all five positions', () => {
  const stickers = [
    { id: 'heart', position: 'top-left', size: 'small', rotation: -15 },
    { id: 'star', position: 'top-right', size: 'medium', rotation: 0 },
    { id: 'rose', position: 'center', size: 'large', rotation: 15 },
    { id: 'hug', position: 'bottom-left' },
    { id: 'birthday', position: 'bottom-right' },
  ];
  const result = validateCardInput({ ...basic, stickers });
  assert.equal(result.valid, true);
  assert.deepEqual(result.card.customization.stickers, [
    stickers[0], { id: 'star', position: 'top-right' }, stickers[2], stickers[3], stickers[4],
  ]);
  assert.deepEqual(publicCardFromRow({ ...basic, customization: result.card.customization }).stickers, result.card.customization.stickers);
  for (const appearance of [
    { size: 'huge' }, { size: null }, { size: 30 }, { size: 'url(private)' },
    { rotation: '15' }, { rotation: null }, { rotation: -16 }, { rotation: 16 }, { rotation: 360 },
    { rotation: NaN }, { rotation: Infinity }, { style: 'transform:rotate(90deg)' },
  ]) {
    const invalid = validateCardInput({ ...basic, stickers: [{ id: 'heart', position: 'center', ...appearance }] });
    assert.equal(invalid.valid, false, JSON.stringify(appearance));
    assert.equal(typeof invalid.fields.stickers, 'string');
  }
  assert.equal(validateCardInput({ ...basic, stickers: [...stickers, { id: 'heart', position: 'center' }] }).valid, false);
});

test('invalid sticker appearance is rejected by the API before any insert', async () => {
  await withServer(async (url, repository) => {
    for (const appearance of [{ size: 'huge' }, { rotation: '15' }, { rotation: 999 }, { background: 'rose' }]) {
      const response = await post(url, { ...basic, stickers: [{ id: 'heart', position: 'center', ...appearance }] });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).fields.stickers, 'string');
    }
    assert.equal(repository.rows.size, 0);
  });
});

test('stored design sanitization preserves valid fields and never exposes arbitrary customization', () => {
  const row = { ...basic, customization: JSON.stringify({
    font: 'serif', design: { background: 'ocean', layout: '<html>', photoLayout: 'split',
      textWeight: 700, lineSpacing: 'airy', decorations: 'unknown', privateCode: 'private' },
    secret: 'private',
  }) };
  const card = publicCardFromRow(row);
  assert.equal(card.font, 'serif');
  assert.equal(card.message, basic.message);
  assert.deepEqual(card.design, { background: 'ocean', photoLayout: 'split', lineSpacing: 'airy' });
  assert.ok(!JSON.stringify(card).includes('private'));
  assert.ok(!JSON.stringify(card).includes('<html>'));
  for (const design of [null, [], 'rose', { ...DESIGN_DEFAULTS }, { layout: 'unknown', secret: 'private' }]) {
    assert.equal(Object.hasOwn(publicCardFromRow({ ...basic, customization: { design } }), 'design'), false);
  }
  assert.equal(Object.hasOwn(publicCardFromRow({ ...basic, customization: '{bad JSON' }), 'design'), false);
});

test('protected cards do not reveal design or sticker appearance until code verification', async () => {
  await withServer(async (url, repository) => {
    const code = 'Our shared memory';
    const stickers = [{ id: 'heart', position: 'center', size: 'large', rotation: 15 }];
    const response = await post(url, { ...basic, design: customized, stickers, protection: { enabled: true, code } });
    assert.equal(response.status, 201);
    const { shareToken } = await response.json();
    const path = `/api/cards/${shareToken}`;
    assert.deepEqual(await (await fetch(`${url}${path}`)).json(), { protection: { enabled: true, hints: [] } });
    assert.equal(repository.contentReads, 0);
    assert.equal((await post(url, { code: 'The wrong memory' }, `${path}/unlock`)).status, 401);
    assert.equal(repository.contentReads, 0);
    const unlocked = await post(url, { code }, `${path}/unlock`);
    assert.equal(unlocked.status, 200);
    const data = await unlocked.json();
    assert.deepEqual(data.card.design, customized);
    assert.deepEqual(data.card.stickers, stickers);
    const cookie = unlocked.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await fetch(`${url}${path}`, { headers: { Cookie: cookie } })).json(), data);
    assert.ok(!JSON.stringify(data).includes(code));
  });
});

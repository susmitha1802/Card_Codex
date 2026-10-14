import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCardInput, publicCardFromRow } from '../src/validation/cards.js';
import { STICKERS, STICKER_POSITIONS } from '../../shared/mediaOptions.js';
import { createApp } from '../src/app.js';
import { once } from 'node:events';

const card = { occasion: 'love', theme: 'romantic', message: 'A note for you.' };

test('stickers are optional and only validated selections enter customization', () => {
  for (const stickers of [undefined, []]) {
    assert.equal(Object.hasOwn(validateCardInput({ ...card, stickers }).card.customization, 'stickers'), false);
  }
  const stickers = STICKER_POSITIONS.map((position, index) => ({ id: STICKERS[index].id, position: position.id }));
  const saved = validateCardInput({ ...card, stickers });
  assert.equal(saved.valid, true);
  assert.deepEqual(saved.card.customization.stickers, stickers);
  assert.deepEqual(publicCardFromRow({ ...card, customization: JSON.stringify(saved.card.customization) }).stickers, stickers);
});

test('sticker IDs, positions, count and object shape are checked on the server', () => {
  for (const stickers of [null, {}, '❤️', [null], [{ id: '<svg onload=alert(1)>', position: 'center' }],
    [{ id: 'heart', position: 'anywhere' }], [{ id: 'heart', position: 'center', html: '<script>' }],
    [{ id: 'heart', position: 'center' }, { id: 'rose', position: 'center' }],
    Array.from({ length: 6 }, () => ({ id: 'heart', position: 'center' }))]) {
    const result = validateCardInput({ ...card, stickers });
    assert.equal(result.valid, false);
    assert.equal(typeof result.fields.stickers, 'string');
  }
});

test('corrupt stored stickers are omitted without exposing arbitrary customization', () => {
  const result = publicCardFromRow({ ...card, customization: { stickers: [{ id: 'injected', position: 'center' }], secret: 'hidden' } });
  assert.equal(result.message, card.message);
  assert.equal(Object.hasOwn(result, 'stickers'), false);
  assert.equal(Object.hasOwn(result, 'secret'), false);
});

test('the creation API rejects injected stickers before storage and saves approved selections', async () => {
  const saved = [];
  const server = createApp({ checkDatabase: async () => {}, cardsRepository: {
    async insert(value) { saved.push(value); },
  } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/cards`;
  const submit = (stickers) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...card, stickers }),
  });
  try {
    for (const sticker of [{ id: '<svg onload=alert(1)>', position: 'center' },
      { id: 'heart', position: 'outside-card' }, { id: 'heart', position: 'center', html: '<script>' }]) {
      const response = await submit([sticker]);
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(typeof result.fields.stickers, 'string');
      assert.ok(!JSON.stringify(result).includes('<svg'));
    }
    assert.equal(saved.length, 0);
    const stickers = [{ id: 'rose', position: 'bottom-right' }];
    assert.equal((await submit(stickers)).status, 201);
    assert.deepEqual(saved[0].customization.stickers, stickers);
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
  }
});

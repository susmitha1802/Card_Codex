import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShareUrl, buildShareLinks, normalizeShareMessage, normalizePublicOrigin,
  DEFAULT_SHARE_MESSAGE, MAX_SHARE_MESSAGE, SHARE_TITLE } from '../../shared/shareLinks.js';

const token = 'Ab7Kx92Lm_'.padEnd(32, 'Q');
const path = `/card/${token}`;
const url = `https://cards.example${path}`;

test('share URLs retain the existing public token and reject external paths, queries and unsafe origins', () => {
  assert.equal(buildShareUrl(path, 'https://cards.example/'), url);
  for (const origin of ['javascript:alert(1)', 'https://user:password@cards.example', 'https://cards.example/path',
    'https://cards.example?secret=code', 'https://cards.example#code']) assert.throws(() => buildShareUrl(path, origin));
  for (const value of ['//other.example/card/token', 'https://other.example/card/token', '/card/1',
    `${path}?code=secret`, `${path}#secret`, `${path}/media/photo`, `${path}\n`, `${path}\r\n`, '/card/<script>', null]) assert.throws(() => buildShareUrl(value, 'https://cards.example'));
  assert.equal(normalizePublicOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
});

test('WhatsApp, email, X and native sharing encode only the intentional intro and canonical URL', () => {
  const message = 'A little joy 💌 & more? #today + tomorrow';
  const links = buildShareLinks(url, message);
  const whatsapp = new URL(links.whatsapp);
  assert.equal(whatsapp.origin, 'https://wa.me');
  assert.deepEqual([...whatsapp.searchParams.keys()], ['text']);
  assert.equal(whatsapp.searchParams.get('text'), `${message}\n${url}`);
  const x = new URL(links.x);
  assert.equal(x.origin, 'https://x.com');
  assert.equal(x.pathname, '/intent/tweet');
  assert.equal(x.searchParams.get('text'), message);
  assert.equal(x.searchParams.get('url'), url);
  const email = new URL(links.email);
  assert.equal(email.protocol, 'mailto:');
  assert.equal(email.pathname, '');
  assert.equal(email.searchParams.get('subject'), SHARE_TITLE);
  assert.equal(email.searchParams.get('body'), `${message}\r\n\r\n${url}`);
  assert.ok(!links.email.includes('+'), 'mailto uses percent-encoded spaces and plus signs.');
  assert.deepEqual(links.native, { title: SHARE_TITLE, text: message, url });
});

test('share messages are bounded plaintext and cannot become additional query parameters or email headers', () => {
  assert.equal(normalizeShareMessage('   '), DEFAULT_SHARE_MESSAGE);
  assert.equal(normalizeShareMessage(' hello\r\nworld '), 'hello world');
  assert.equal(Array.from(normalizeShareMessage('💌'.repeat(300))).length, MAX_SHARE_MESSAGE);
  const intro = 'hello&url=https://evil.example\nBcc: attacker@example.com';
  const links = buildShareLinks(url, intro);
  assert.deepEqual([...new URL(links.email).searchParams.keys()], ['subject', 'body']);
  assert.deepEqual([...new URL(links.x).searchParams.keys()], ['text', 'url']);
  assert.equal(new URL(links.x).searchParams.get('url'), url);
  assert.doesNotThrow(() => buildShareLinks(url, '\ud800\udfff\ud800'));
  for (const value of [`${url}?code=private`, `${url}#private`, 'https://user:private@cards.example' + path,
    'data:text/html,<script>', 'javascript:alert(1)']) assert.throws(() => buildShareLinks(value));
});

test('message normalization also works in browsers without String.toWellFormed', () => {
  const original = String.prototype.toWellFormed;
  try {
    String.prototype.toWellFormed = undefined;
    assert.equal(normalizeShareMessage('💌\ud800'), '💌�');
    assert.doesNotThrow(() => buildShareLinks(url, '\udfff'));
  } finally { String.prototype.toWellFormed = original; }
});

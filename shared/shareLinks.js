export const DEFAULT_SHARE_MESSAGE = 'I made something for you 💌';
export const MAX_SHARE_MESSAGE = 160;
export const SHARE_TITLE = 'A little card, just for you';
const cardPathPattern = /^\/card\/[A-Za-z0-9_-]{32}$/;

export function normalizePublicOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS origin without a path, credentials, query, or fragment.');
  }
  return url.origin;
}

export function buildShareUrl(cardPath, origin) {
  if (typeof cardPath !== 'string' || cardPath.length !== 38 || !cardPathPattern.test(cardPath)) {
    throw new Error('This card link could not be confirmed.');
  }
  return new URL(cardPath, normalizePublicOrigin(origin)).href;
}

export function normalizeShareMessage(value) {
  const text = typeof value === 'string' ? value : '';
  // Encoding never receives a malformed surrogate from pasted text.
  const safe = typeof text.toWellFormed === 'function' ? text.toWellFormed()
    : Array.from(text).map((character) => {
      const code = character.charCodeAt(0);
      return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? '�' : character;
    }).join('');
  return Array.from(safe.replace(/\s+/gu, ' ').trim()).slice(0, MAX_SHARE_MESSAGE).join('') || DEFAULT_SHARE_MESSAGE;
}

export function buildShareLinks(shareUrl, message = DEFAULT_SHARE_MESSAGE) {
  const url = new URL(shareUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('This card link could not be confirmed.');
  const canonical = buildShareUrl(url.pathname, url.origin);
  const intro = normalizeShareMessage(message);
  const whatsapp = new URL('https://wa.me/');
  whatsapp.searchParams.set('text', `${intro}\n${canonical}`);
  const x = new URL('https://x.com/intent/tweet');
  x.searchParams.set('text', intro);
  x.searchParams.set('url', canonical);
  return {
    whatsapp: whatsapp.href,
    email: `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(`${intro}\r\n\r\n${canonical}`)}`,
    x: x.href,
    native: { title: SHARE_TITLE, text: intro, url: canonical },
  };
}

import { compactDesign } from '../../../shared/designOptions.js';

export async function createCard(card, protection, photos = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), photos.length ? 60000 : 15000);
  const { stickers, design, ...content } = card;
  const customDesign = compactDesign(design);
  const data = {
    ...content,
    ...(Object.keys(customDesign).length ? { design: customDesign } : {}),
    ...(stickers?.length ? { stickers } : {}),
    ...(protection?.enabled ? { protection: {
      enabled: true, code: protection.code,
      hints: protection.hints.map((hint) => hint.trim()).filter(Boolean),
    } } : {}),
  };
  const upload = photos.length ? new FormData() : null;
  if (upload) {
    upload.append('card', JSON.stringify(data));
    photos.forEach((photo) => upload.append('photos', photo.file));
  }
  try {
    const response = await fetch('/api/cards', {
      method: 'POST',
      // The browser supplies the multipart boundary when files are included.
      headers: upload ? {} : { 'Content-Type': 'application/json' },
      body: upload ?? JSON.stringify(data),
      signal: controller.signal,
    });
    // Proxies can return non-JSON errors, so keep a friendly fallback.
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(response.status === 413 ? 'A photo or card is too large. Use up to four photos, no larger than 5 MiB each.' : response.status === 400
        ? 'Please check your card details below.'
        : 'Your card could not be saved. Please try again in a moment.');
      if (response.status === 400 && body?.fields && typeof body.fields === 'object') {
        error.fields = Object.values(body.fields).filter((value) => typeof value === 'string');
      }
      throw error;
    }
    if (typeof body?.shareToken !== 'string' || body.shareToken.length !== 32 || !/^[A-Za-z0-9_-]{32}$/.test(body.shareToken) ||
        body.cardPath !== `/card/${body.shareToken}`) {
      throw new Error('Your card link could not be confirmed. Please try again.');
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('We couldn’t reach the server. Check your connection and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function unlockCard(shareToken, code, signal) {
  let response;
  try {
    response = await fetch(`/api/cards/${encodeURIComponent(shareToken)}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal,
    });
  } catch {
    throw new Error('We couldn’t reach the server. Check your connection and try again.');
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    const error = new Error('Too many attempts. Please wait a little before trying again.');
    error.retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60;
    throw error;
  }
  if (response.status === 401 || response.status === 404) {
    throw new Error('We couldn’t unlock this card. Check the code and link with the sender, then try again.');
  }
  if (!response.ok) {
    throw new Error('We couldn’t open your card just yet. Please try again in a moment.');
  }
  const body = await response.json().catch(() => null);
  if (!body?.card) throw new Error('We couldn’t open your card just yet. Please try again.');
  return body.card;
}

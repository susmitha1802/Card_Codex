import { randomBytes } from 'node:crypto';

const opaqueGrant = /^[A-Za-z0-9_-]{43}$/;

// A grant unlocks one card in this browser for a short time. It is not an account.
// Bind grants to the stored hash so a changed code invalidates old access.
export function createMediaGrants({ ttlMs = 30 * 60 * 1000, maxGrants = 10000, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxGrants) || maxGrants < 1) {
    throw new Error('Media grant lifetime and capacity must be positive.');
  }
  const grants = new Map();
  function prune() {
    const current = now();
    for (const [key, value] of grants) if (value.expiresAt <= current) grants.delete(key);
  }
  return {
    ttlMs,
    issue(shareToken, codeHash) {
      prune();
      while (grants.size >= maxGrants) grants.delete(grants.keys().next().value);
      const value = randomBytes(32).toString('base64url');
      grants.set(value, { shareToken, codeHash, expiresAt: now() + ttlMs });
      return value;
    },
    allows(value, shareToken, codeHash) {
      if (typeof value !== 'string' || value.length !== 43 || !opaqueGrant.test(value)) return false;
      const grant = grants.get(value);
      if (!grant) return false;
      if (grant.expiresAt <= now()) {
        grants.delete(value);
        return false;
      }
      return grant.shareToken === shareToken && grant.codeHash === codeHash;
    },
  };
}

// Read only our generated cookie value. No cookie-parser dependency is needed.
export function readMediaGrant(request) {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return null;
  const values = cookie.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith('card_access='));
  if (values.length !== 1) return null;
  const value = values[0].slice('card_access='.length);
  return value.length === 43 && opaqueGrant.test(value) ? value : null;
}

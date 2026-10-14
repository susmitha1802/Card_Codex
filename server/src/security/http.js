import { normalizePublicOrigin } from '../../../shared/shareLinks.js';

export function createHttpSecurity({ production = false, publicOrigin = 'http://127.0.0.1:5173' } = {}) {
  const origin = normalizePublicOrigin(publicOrigin);
  if (production && !origin.startsWith('https://')) throw new Error('Production HTTP security requires an explicit HTTPS public origin.');
  const allowedOrigins = new Set(production ? [origin]
    : [origin, 'http://127.0.0.1:5173', 'http://localhost:5173']);
  const csp = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", "connect-src 'self'", "font-src 'self'", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');

  return (request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), web-share=(self)',
    });
    if (production) {
      // React uses inline styles for card appearance. Inline scripts remain blocked.
      response.set('Content-Security-Policy', csp);
      if (origin.startsWith('https://')) response.set('Strict-Transport-Security', 'max-age=15552000');
    }
    if (!(request.path === '/api' || request.path.startsWith('/api/'))) return next();
    response.vary('Origin');
    const requestOrigin = request.get('Origin');
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
      return response.status(403).json({ error: 'This browser origin is not allowed.' });
    }
    if (requestOrigin) response.set({ 'Access-Control-Allow-Origin': requestOrigin, 'Access-Control-Allow-Credentials': 'true' });
    if (request.method !== 'OPTIONS') return next();
    const method = request.get('Access-Control-Request-Method');
    const headers = (request.get('Access-Control-Request-Headers') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!requestOrigin || !['GET', 'HEAD', 'POST'].includes(method) || headers.some((header) => header !== 'content-type')) {
      return response.status(403).json({ error: 'This browser request is not allowed.' });
    }
    response.set({ 'Access-Control-Allow-Methods': 'GET, HEAD, POST', 'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' });
    return response.status(204).end();
  };
}

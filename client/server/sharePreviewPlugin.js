import { readFile } from 'node:fs/promises';
import { getPreviewCopy, renderShareDocument } from '../../shared/sharePreview.js';
import { normalizePublicOrigin } from '../../shared/shareLinks.js';

// A tiny server middleware adds crawler metadata to the existing Vite HTML.
// It does not change browser routing or copy any card content into the HTML.
export function sharePreviewPlugin({ apiTarget, publicOrigin }) {
  const origin = normalizePublicOrigin(publicOrigin);
  const indexFile = new URL('../index.html', import.meta.url);
  const builtIndexFile = new URL('../dist/index.html', import.meta.url);

  function middleware(viteServer, development) {
    return async (request, response, next) => {
      let pathname;
      try { pathname = new URL(request.url, origin).pathname; }
      catch {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        return response.end(request.method === 'HEAD' ? '' : 'This link could not be read.');
      }
      if (!['GET', 'HEAD'].includes(request.method) || !/^\/card(?:\/|$)/.test(pathname)) return next();
      const shareToken = pathname.match(/^\/card\/([A-Za-z0-9_-]{32})\/?$/)?.[1] ?? 'invalid';
      let status = 404;
      try {
        if (shareToken !== 'invalid') {
          try {
            const preview = await fetch(new URL(`/api/share-preview/${shareToken}`, apiTarget), { signal: AbortSignal.timeout(5000) });
            status = preview.status === 200 ? 200 : preview.status === 404 ? 404 : 503;
          } catch { status = 503; }
        }
        const template = await readFile(development ? indexFile : builtIndexFile, 'utf8');
        let html = renderShareDocument(template, { status, shareToken, publicOrigin: origin });
        if (development) html = await viteServer.transformIndexHtml(pathname, html);
        response.statusCode = status;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(request.method === 'HEAD' ? '' : html);
      } catch {
        const copy = getPreviewCopy(503);
        response.statusCode = 503;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(request.method === 'HEAD' ? '' : `${copy.title} ${copy.description}`);
      }
    };
  }

  return {
    name: 'card-share-previews',
    configureServer(server) { server.middlewares.use(middleware(server, true)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(server, false)); },
  };
}

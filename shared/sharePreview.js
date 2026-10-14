import { normalizePublicOrigin } from './shareLinks.js';

export function getPreviewCopy(status) {
  if (status === 200) return {
    title: 'Someone made something for you 💌 · Emotale',
    description: 'Little messages. Lasting feelings. A thoughtful little card is waiting. Open it to see your surprise.',
  };
  if (status === 404) return {
    title: 'This card couldn’t be found · Emotale',
    description: 'This card may no longer be available. Ask the sender to check the link.',
  };
  return {
    title: 'We couldn’t open this card just yet · Emotale',
    description: 'Please try this card link again in a moment.',
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// Social crawlers receive these tags in the original HTML, before React runs.
// The only card-specific input is its validated public token, never its content.
export function renderShareDocument(template, { status, shareToken, publicOrigin }) {
  const origin = normalizePublicOrigin(publicOrigin);
  const validToken = typeof shareToken === 'string' && shareToken.length === 32 && /^[A-Za-z0-9_-]{32}$/.test(shareToken);
  const path = validToken ? `/card/${shareToken}` : '/card/invalid';
  const canonical = `${origin}${path}`;
  const image = `${origin}/share-preview.png`;
  const copy = getPreviewCopy(status);
  const meta = (attribute, name, value) => `<meta ${attribute}="${name}" content="${escapeHtml(value)}" />`;
  const tags = [
    meta('name', 'description', copy.description),
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    meta('property', 'og:type', 'website'), meta('property', 'og:site_name', 'Emotale'),
    meta('property', 'og:title', copy.title), meta('property', 'og:description', copy.description),
    meta('property', 'og:url', canonical), meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'), meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'), meta('property', 'og:image:alt', 'A decorative Emotale envelope. No card contents are shown.'),
    meta('name', 'twitter:card', 'summary_large_image'), meta('name', 'twitter:title', copy.title),
    meta('name', 'twitter:description', copy.description), meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', 'A decorative Emotale envelope. No card contents are shown.'),
  ].join('\n    ');
  return template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(copy.title)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace('</head>', `  ${tags}\n  </head>`);
}

import { getOccasion, getTheme } from './cardOptions.js';
import './card-preview.css';
import { STICKERS } from '../../../../shared/mediaOptions.js';
import { STICKER_ROTATIONS, STICKER_SIZES } from '../../../../shared/designOptions.js';
import { resolveCardDesign } from '../../../../shared/cardDesign.js';
import PhotoGallery from './PhotoGallery.jsx';
import CardDecorations from './CardDecorations.jsx';
import './card-design.css';

/** One shared renderer keeps the preview in sync with every editor control. */
export default function CardPreview({ card, photos = card.photos ?? [], accessibleLabel = 'Live card preview', onPhotoError }) {
  const occasion = getOccasion(card.occasion);
  const theme = getTheme(card.theme);
  const resolved = resolveCardDesign(card, photos.length);
  const title = card.title.trim() || occasion.defaultTitle;
  const recipient = card.recipientName.trim();
  const hasMessage = Boolean(card.message.trim());
  const stickers = card.stickers ?? [];
  function stickerAt(position) {
    const sticker = stickers.find((item) => item.position === position);
    const choice = STICKERS.find((item) => item.id === sticker?.id);
    if (!choice) return null;
    const size = STICKER_SIZES.some((item) => item.id === sticker.size) ? sticker.size : 'medium';
    const rotation = STICKER_ROTATIONS.includes(sticker.rotation) ? sticker.rotation : 0;
    return (
      <span
        className="card-sticker-placement"
        data-sticker-id={choice.id}
        data-sticker-size={size}
        data-sticker-rotation={rotation}
        style={{ '--sticker-rotation': `${rotation}deg` }}
      >
        <span role="img" aria-label={`${choice.label} sticker`}>{choice.emoji}</span>
      </span>
    );
  }
  function stickerRow(top) {
    const prefix = top ? 'top' : 'bottom';
    if (!stickers.some((item) => item.position.startsWith(prefix))) return null;
    return <div className={`card-sticker-row${top ? '' : ' card-sticker-bottom'}`}>
      <div className="sticker-left">{stickerAt(`${prefix}-left`)}</div>
      <div className="sticker-right">{stickerAt(`${prefix}-right`)}</div>
    </div>;
  }

  const appearance = {
    '--preview-font': resolved.fontFamily,
    '--preview-text-color': resolved.textColor,
    '--preview-message-size': `${resolved.fontSize}px`,
    '--preview-text-weight': resolved.textWeight,
    '--preview-line-height': resolved.lineHeight,
    '--reading-surface': resolved.readabilitySurface ?? undefined,
    '--card-accent': resolved.background ? resolved.textColor : undefined,
    '--card-muted': resolved.background ? resolved.textColor : undefined,
    background: resolved.background?.css,
    textAlign: card.alignment,
  };
  const photosBeforeMessage = ['photo', 'collage'].includes(resolved.effectiveLayout);
  const gallery = <PhotoGallery photos={photos} layout={resolved.photoLayout} onPhotoError={onPhotoError} />;

  return (
    <article
      className="card-preview"
      style={appearance}
      data-theme={theme.id}
      data-alignment={card.alignment}
      data-layout={resolved.effectiveLayout}
      data-requested-layout={resolved.design.layout}
      data-background={resolved.design.background}
      data-photo-layout={resolved.photoLayout}
      data-decorations={resolved.design.decorations}
      data-color-adjusted={resolved.effectiveColorAdjusted ? 'true' : 'false'}
      data-testid="card-preview"
      aria-label={accessibleLabel}
    >
      <div className="card-decoration" aria-hidden="true">
        <span className="card-decoration-shape shape-one" />
        <span className="card-decoration-shape shape-two" />
        <span className="card-decoration-shape shape-three" />
        <span className="card-decoration-shape shape-four" />
      </div>
      <CardDecorations decoration={resolved.design.decorations} />

      <div className="card-preview-content">
        {stickerRow(true)}
        <p className="card-occasion">{occasion.label}</p>
        <div className="card-illustration" aria-hidden="true">
          <span className="card-illustration-halo" />
          <span className="card-occasion-emoji">{occasion.emoji}</span>
          <span className="card-illustration-spark spark-left">✦</span>
          <span className="card-illustration-spark spark-right">✧</span>
        </div>

        <div className={`card-readable-copy${resolved.readabilitySurface ? ' has-reading-surface' : ''}`}>
          {recipient && <p className="card-recipient">For {recipient}</p>}
          <h2 className="card-title" data-testid="preview-title">{title}</h2>
          <div className="card-message-rule" aria-hidden="true" />
          {photosBeforeMessage && gallery}
          <p
            className={`card-message${hasMessage ? '' : ' card-message-placeholder'}`}
            data-testid="preview-message"
          >
            {hasMessage ? card.message : 'Your words will appear here.\nA little space for something heartfelt.'}
          </p>
          {stickerAt('center') && <div className="card-sticker-center">{stickerAt('center')}</div>}
        </div>
        {!photosBeforeMessage && gallery}
        {stickerRow(false)}

        <div className="card-closing-ornament" aria-hidden="true">
          <span />
          <span>✦</span>
          <span />
        </div>
      </div>
    </article>
  );
}

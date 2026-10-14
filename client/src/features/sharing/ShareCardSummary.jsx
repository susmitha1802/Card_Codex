import { getOccasion, getTheme } from '../../../../shared/cardOptions.js';
import { resolveCardDesign } from '../../../../shared/cardDesign.js';

function messageExcerpt(message = '') {
  const characters = Array.from(message.trim());
  return characters.length > 120 ? `${characters.slice(0, 119).join('')}…` : characters.join('');
}

// This is a sender-only snapshot from React state. It never requests card media.
export default function ShareCardSummary({ card, isProtected = false }) {
  if (!card) return null;
  const occasion = getOccasion(card.occasion);
  const theme = getTheme(card.theme);
  const photoCount = card.photoCount ?? 0;
  const appearance = resolveCardDesign(card, photoCount);

  return (
    <section className="share-card-summary" aria-labelledby="share-summary-heading">
      <div className="share-summary-heading">
        <h2 id="share-summary-heading">Your card at a glance</h2>
        <span>Sender preview</span>
      </div>
      <div className={`share-summary-card share-summary-theme-${theme.id}`} style={{
        background: appearance.background?.css,
        color: appearance.textColor,
        fontFamily: appearance.fontFamily,
      }}>
        <span className="share-summary-emoji" aria-hidden="true">{occasion.emoji}</span>
        <div className="share-summary-text" style={{
          textAlign: card.alignment ?? 'center',
          background: appearance.readabilitySurface ?? undefined,
        }}>
          {card.recipientName?.trim() && <p className="share-summary-recipient">For {card.recipientName.trim()}</p>}
          <h3>{card.title?.trim() || occasion.defaultTitle}</h3>
          <p className="share-summary-message" style={{ fontWeight: appearance.textWeight }}>{messageExcerpt(card.message)}</p>
        </div>
      </div>
      <div className="share-summary-meta">
        <span>{occasion.label}</span>
        <span>{theme.name} theme</span>
        <span>{photoCount} {photoCount === 1 ? 'photo' : 'photos'}</span>
        {isProtected && <span>Secret code enabled</span>}
      </div>
      <p className="share-summary-note">This preview stays in this tab.</p>
    </section>
  );
}

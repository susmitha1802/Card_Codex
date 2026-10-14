import { useRef, useState } from 'react';
import OccasionPicker from './OccasionPicker.jsx';
import CardContentFields from './CardContentFields.jsx';
import ThemePicker from './ThemePicker.jsx';
import AppearanceControls from './AppearanceControls.jsx';
import DesignControls, { PhotoLayoutControl } from './DesignControls.jsx';
import TemplatePicker from './TemplatePicker.jsx';
import ProtectionFields from './ProtectionFields.jsx';
import PhotosFields from './PhotosFields.jsx';
import StickersFields from './StickersFields.jsx';
import usePhotos from './usePhotos.js';
import CardPreview from './CardPreview.jsx';
import { getTheme } from './cardOptions.js';
import { createCard } from '../../api/cards.js';
import CardCreatedPage from '../sharing/CardCreatedPage.jsx';
import { DESIGN_DEFAULTS } from '../../../../shared/designOptions.js';
import { resolveCardDesign } from '../../../../shared/cardDesign.js';

const initialCard = {
  occasion: 'birthday',
  recipientName: '',
  title: '',
  message: '',
  theme: 'birthday',
  font: 'theme',
  textColor: null,
  fontSize: 'medium',
  alignment: 'center',
  stickers: [],
};

const emptyProtection = () => ({ enabled: false, code: '', hints: ['', ''] });

export default function CardCreator() {
  // Editing stays in React state. Only submitting the form sends a card.
  const [card, setCard] = useState(initialCard);
  // Codes stay separate from appearance settings and never enter the preview.
  const [protection, setProtection] = useState(emptyProtection);
  const { photos, photoError, addPhotos, removePhoto, movePhoto, clearPhotos } = usePhotos();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [createdCard, setCreatedCard] = useState(null);
  const savingInProgress = useRef(false);

  function updateCard(field, value) {
    setCard((currentCard) => ({ ...currentCard, [field]: value }));
    setSaveError(null);
  }

  function updateDesign(field, value) {
    setCard((currentCard) => ({
      ...currentCard,
      design: { ...DESIGN_DEFAULTS, ...currentCard.design, [field]: value },
    }));
    setSaveError(null);
  }

  function applyTemplate(template) {
    setCard((currentCard) => ({
      ...currentCard,
      ...template.card,
      recipientName: currentCard.recipientName,
      design: { ...template.card.design },
      stickers: template.card.stickers.map((sticker) => ({ ...sticker })),
    }));
    setSaveError(null);
  }

  function updateProtection(field, value) {
    setProtection((current) => field === 'enabled' && !value
      ? emptyProtection()
      : { ...current, [field]: value });
    setSaveError(null);
  }

  async function handleCreate(event) {
    event.preventDefault();
    // The ref closes the tiny gap before React renders the disabled button.
    if (savingInProgress.current) return;
    if (!card.message.trim()) {
      setSaveError({ message: 'Write a message before creating your card.', fields: [] });
      document.getElementById('card-message')?.focus();
      return;
    }
    if (protection.enabled && (!protection.code.trim()
      || Array.from(protection.code).length < 8 || Array.from(protection.code).length > 128)) {
      setSaveError({ message: 'Choose a secret code with 8–128 characters.', fields: [] });
      document.getElementById('protection-code')?.focus();
      return;
    }
    savingInProgress.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await createCard(card, protection, photos);
      // Keep a small sender preview, without secret codes or photo URLs.
      const completedCard = {
        ...result,
        preview: { ...card, photoCount: photos.length },
        isProtected: protection.enabled,
      };
      setProtection(emptyProtection());
      clearPhotos();
      setCreatedCard(completedCard);
    } catch (error) {
      setSaveError({ message: error.message, fields: error.fields ?? [] });
    } finally {
      savingInProgress.current = false;
      setIsSaving(false);
    }
  }

  function createAnother() {
    setCard(initialCard);
    setProtection(emptyProtection());
    clearPhotos();
    setSaveError(null);
    setCreatedCard(null);
  }

  if (createdCard) {
    return <CardCreatedPage cardPath={createdCard.cardPath} preview={createdCard.preview}
      isProtected={createdCard.isProtected} onCreateAnother={createAnother} />;
  }
  const theme = getTheme(card.theme);
  const resolvedDesign = resolveCardDesign(card, photos.length);

  return (
    <div className="creator-page">
      <header className="creator-header">
        <a className="creator-brand" href="/" aria-label="Emotale home">
          <span className="creator-brand-mark" aria-hidden="true">✦</span>
          <span>Emotale</span>
        </a>
        <a className="health-link" href="/health" target="_blank" rel="noreferrer">
          Connection status<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>
      <main className="creator-main">
        <div className="creator-intro">
          <div>
            <p className="creator-eyebrow">Little messages. Lasting feelings.</p>
            <h1>Make it <span>personal.</span></h1>
            <p>For the big moments. And the beautifully ordinary ones.</p>
          </div>
          <span className="creator-note">Your words, their little moment.</span>
        </div>
        <nav className="creator-steps" aria-label="Card creation sections">
          <a href="#occasion-section"><span aria-hidden="true">01</span> Pick an occasion</a>
          <a href="#message-section"><span aria-hidden="true">02</span> Write your message</a>
          <a href="#theme-section"><span aria-hidden="true">03</span> Make it yours</a>
        </nav>
        <div className="creator-workspace">
          <form className="editor-panel" id="card-details" aria-label="Card details" onSubmit={handleCreate}>
            <fieldset className="creator-fields" disabled={isSaving}>
              <legend className="sr-only">Personalize your card</legend>
              <TemplatePicker onApply={applyTemplate} />
              <OccasionPicker value={card.occasion} onChange={(value) => updateCard('occasion', value)} />
              <CardContentFields card={card} onChange={updateCard} />
              <ThemePicker value={card.theme} onChange={(value) => updateCard('theme', value)} />
              <DesignControls design={card.design} onChange={updateDesign} />
              <AppearanceControls card={card} onChange={updateCard} onDesignChange={updateDesign} />
              <ProtectionFields protection={protection} onChange={updateProtection} />
              <PhotosFields photos={photos} error={photoError} onAdd={addPhotos} onRemove={removePhoto} onMove={movePhoto} />
              <PhotoLayoutControl design={card.design} onChange={updateDesign} />
              <StickersFields stickers={card.stickers} onChange={(value) => updateCard('stickers', value)} />
            </fieldset>
            <div className="create-action">
              {saveError && (
                <div className="save-error" role="alert">
                  <p>{saveError.message}</p>
                  {saveError.fields.length > 0 && <ul>{saveError.fields.map((message) => <li key={message}>{message}</li>)}</ul>}
                </div>
              )}
              <button className="create-card-button" type="submit" disabled={isSaving} aria-busy={isSaving}>
                {isSaving ? 'Creating your card…' : <>Create Card <span aria-hidden="true">💌</span></>}
              </button>
              <p className="create-action-note">Create a link to this little moment.</p>
            </div>
          </form>
          <aside className="preview-panel" id="live-preview" aria-label="Preview area" tabIndex={-1}>
            <div className="preview-sticky">
              <div className="preview-heading">
                <div>
                  <p className="preview-eyebrow">The little moment</p>
                  <h2>Your card, coming to life.</h2>
                </div>
                <span className="preview-live-label"><span aria-hidden="true" />Live preview</span>
              </div>
              <div className="preview-stage"><CardPreview card={card} photos={photos} /></div>
              <div className="preview-caption">
                <span><strong>{theme.name}</strong> theme</span>
                <span>Updates as you type</span>
              </div>
              {(resolvedDesign.effectiveColorAdjusted || resolvedDesign.readabilitySurface) && (
                <p className="readability-note" role="status">
                  {resolvedDesign.effectiveColorAdjusted
                    ? 'The card uses a more readable text color for this background. Your color choice is kept in the editor.'
                    : 'A contrasting panel keeps your message readable with your chosen text color.'}
                </p>
              )}
              <p className="draft-note">Your edits stay in this tab until you create your card.</p>
            </div>
          </aside>
        </div>
        <footer className="creator-footer">Emotale · Little messages. Lasting feelings.</footer>
      </main>
      <nav className="mobile-preview-nav" aria-label="Creator shortcuts">
        <a href="#card-details">Edit card</a>
        <a href="#live-preview">See live preview</a>
      </nav>
    </div>
  );
}

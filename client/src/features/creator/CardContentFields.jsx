import { getOccasion } from './cardOptions.js';

export default function CardContentFields({ card, onChange }) {
  const occasion = getOccasion(card.occasion);
  const hasWhitespaceOnlyMessage = card.message.length > 0 && card.message.trim().length === 0;

  return (
    <section className="editor-section" id="message-section" tabIndex={-1} aria-labelledby="content-heading">
      <div className="section-heading">
        <span className="section-number" aria-hidden="true">02</span>
        <h2 className="section-title" id="content-heading">Make it personal</h2>
      </div>
      <p className="section-description">The best part of this card is what you have to say.</p>

      <div className="field-group">
        <label className="field-label" htmlFor="recipient-name">
          Recipient name <span className="optional-label">Optional</span>
        </label>
        <input
          className="text-input"
          id="recipient-name"
          name="recipientName"
          type="text"
          autoComplete="off"
          placeholder="Who is this little moment for?"
          value={card.recipientName}
          onChange={(event) => onChange('recipientName', event.target.value)}
        />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="card-title">
          Card title <span className="optional-label">Optional</span>
        </label>
        <input
          className="text-input"
          id="card-title"
          name="title"
          type="text"
          placeholder={occasion.defaultTitle}
          aria-describedby="title-note"
          value={card.title}
          onChange={(event) => onChange('title', event.target.value)}
        />
        <p className="field-note" id="title-note">Leave it blank to use “{occasion.defaultTitle}”.</p>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="card-message">
          Your message <span className="optional-label">Required</span>
        </label>
        <textarea
          className="text-input message-input"
          id="card-message"
          name="message"
          rows={5}
          required
          placeholder="Write something that sounds like you…"
          aria-describedby="message-note"
          aria-invalid={hasWhitespaceOnlyMessage || undefined}
          value={card.message}
          onChange={(event) => onChange('message', event.target.value)}
        />
        <div className="message-meta">
          <p className="field-note" id="message-note">
            {hasWhitespaceOnlyMessage
              ? 'Add a few words — spaces alone do not make a message.'
              : 'A few words can mean a lot. Line breaks are welcome.'}
          </p>
          <span>{card.message.length.toLocaleString()} characters</span>
        </div>
      </div>
    </section>
  );
}

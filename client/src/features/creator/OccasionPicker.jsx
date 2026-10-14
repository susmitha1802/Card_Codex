import { OCCASIONS } from './cardOptions.js';

export default function OccasionPicker({ value, onChange }) {
  return (
    <fieldset className="editor-section" id="occasion-section" tabIndex={-1}>
      <legend className="section-heading">
        <span className="section-number" aria-hidden="true">01</span>
        <span className="section-title">What's the occasion?</span>
      </legend>
      <p className="section-description">Big moments. Little moments. All worth a card.</p>
      <div className="occasion-grid">
        {OCCASIONS.map((occasion) => (
          <label
            className={`choice-option occasion-option${value === occasion.id ? ' is-selected' : ''}`}
            key={occasion.id}
          >
            <input
              className="sr-only"
              type="radio"
              name="occasion"
              value={occasion.id}
              checked={value === occasion.id}
              onChange={() => onChange(occasion.id)}
            />
            <span className="choice-emoji" aria-hidden="true">{occasion.emoji}</span>
            <span className="choice-label">{occasion.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

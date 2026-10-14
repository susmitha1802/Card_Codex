import { THEMES } from './cardOptions.js';

export default function ThemePicker({ value, onChange }) {
  return (
    <fieldset className="editor-section" id="theme-section" tabIndex={-1}>
      <legend className="section-heading">
        <span className="section-number" aria-hidden="true">03</span>
        <span className="section-title">Set the mood</span>
      </legend>
      <p className="section-description">Pick a look that feels like your message.</p>
      <div className="theme-grid">
        {THEMES.map((theme) => (
          <label
            className={`choice-option theme-option${value === theme.id ? ' is-selected' : ''}`}
            key={theme.id}
          >
            <input
              className="sr-only"
              type="radio"
              name="theme"
              value={theme.id}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
            />
            <span className={`theme-swatch swatch-${theme.id}`} aria-hidden="true">Aa</span>
            <span className="theme-name">{theme.name}</span>
            <span className="theme-description">{theme.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

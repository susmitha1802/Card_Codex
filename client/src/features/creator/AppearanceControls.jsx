import { FONT_OPTIONS, FONT_SIZES, getTheme } from './cardOptions.js';
import { DESIGN_DEFAULTS, LINE_SPACINGS, TEXT_WEIGHTS } from '../../../../shared/designOptions.js';
import './design-controls.css';

const ALIGNMENTS = ['left', 'center', 'right'];

export default function AppearanceControls({ card, onChange, onDesignChange }) {
  const theme = getTheme(card.theme);
  const design = { ...DESIGN_DEFAULTS, ...card.design };

  return (
    <section className="editor-section" aria-labelledby="appearance-heading">
      <div className="section-heading">
        <span className="section-number" aria-hidden="true">04</span>
        <h2 className="section-title" id="appearance-heading">A finishing touch</h2>
      </div>
      <p className="section-description">Small details to make it feel a little more you.</p>
      <div className="appearance-grid">
        <div className="field-group">
          <label className="field-label" htmlFor="card-font">Font style</label>
          <select
            className="text-input"
            id="card-font"
            value={card.font}
            onChange={(event) => onChange('font', event.target.value)}
          >
            {FONT_OPTIONS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="card-font-size">Message size</label>
          <select
            className="text-input"
            id="card-font-size"
            value={card.fontSize}
            onChange={(event) => onChange('fontSize', event.target.value)}
          >
            {FONT_SIZES.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </div>

        <fieldset className="field-group">
          <legend className="field-label">Text alignment</legend>
          <div className="alignment-controls">
            {ALIGNMENTS.map((alignment) => (
              <button
                className={`alignment-option${card.alignment === alignment ? ' is-selected' : ''}`}
                key={alignment}
                type="button"
                aria-pressed={card.alignment === alignment}
                onClick={() => onChange('alignment', alignment)}
              >
                {alignment[0].toUpperCase() + alignment.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field-group">
          <label className="field-label" htmlFor="card-text-color">Text color</label>
          <div className="color-controls">
            <input
              className="color-input"
              id="card-text-color"
              type="color"
              value={card.textColor ?? theme.textColor}
              onChange={(event) => onChange('textColor', event.target.value)}
            />
            <button
              className="color-reset"
              type="button"
              onClick={() => onChange('textColor', null)}
            >
              Theme default
            </button>
          </div>
        </div>
      </div>
      <details className="advanced-controls appearance-advanced">
        <summary>More text options <span className="optional-label">Optional</span></summary>
        <div className="design-options-grid">
          <div className="field-group">
            <label className="field-label" htmlFor="card-text-weight">Text weight</label>
            <select className="text-input" id="card-text-weight" value={design.textWeight}
              onChange={(event) => onDesignChange('textWeight', event.target.value)}>
              {TEXT_WEIGHTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="card-line-spacing">Line spacing</label>
            <select className="text-input" id="card-line-spacing" value={design.lineSpacing}
              onChange={(event) => onDesignChange('lineSpacing', event.target.value)}>
              {LINE_SPACINGS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
        </div>
      </details>
    </section>
  );
}

import {
  BACKGROUNDS, CARD_LAYOUTS, DECORATIONS, DESIGN_DEFAULTS, PHOTO_LAYOUTS,
} from '../../../../shared/designOptions.js';
import './design-controls.css';

function DesignSelect({ id, label, options, value, onChange }) {
  const categories = [...new Set(options.map((option) => option.category).filter(Boolean))];
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>{label}</label>
      <select className="text-input" id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {categories.length > 0
          ? categories.map((category) => <optgroup key={category} label={category}>
            {options.filter((option) => option.category === category).map((option) =>
              <option key={option.id} value={option.id}>{option.label}</option>)}
          </optgroup>)
          : options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  );
}

export default function DesignControls({ design, onChange }) {
  const current = { ...DESIGN_DEFAULTS, ...design };
  return (
    <section className="editor-section design-section" aria-label="Optional design settings">
      <details className="advanced-controls">
        <summary>Background, layout &amp; decorations <span className="optional-label">Optional</span></summary>
        <p className="field-note">Keep the theme as it is, or give your words a different setting.</p>
        <div className="design-options-grid">
          <DesignSelect id="card-background" label="Background" options={BACKGROUNDS} value={current.background}
            onChange={(value) => onChange('background', value)} />
          <DesignSelect id="card-layout" label="Card layout" options={CARD_LAYOUTS} value={current.layout}
            onChange={(value) => onChange('layout', value)} />
          <DesignSelect id="card-decorations" label="Decorations" options={DECORATIONS} value={current.decorations}
            onChange={(value) => onChange('decorations', value)} />
        </div>
      </details>
    </section>
  );
}

export function PhotoLayoutControl({ design, onChange }) {
  return (
    <section className="editor-section photo-layout-section" aria-label="Optional photo layout">
      <DesignSelect id="card-photo-layout" label={<>Photo layout <span className="optional-label">Optional</span></>}
        options={PHOTO_LAYOUTS} value={design?.photoLayout ?? DESIGN_DEFAULTS.photoLayout}
        onChange={(value) => onChange('photoLayout', value)} />
      <p className="field-note">Choose how photos appear if you add any. Your card works beautifully without them.</p>
    </section>
  );
}

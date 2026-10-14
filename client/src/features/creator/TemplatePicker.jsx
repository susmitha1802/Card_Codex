import { useState } from 'react';
import { CARD_TEMPLATES } from './templates.js';
import './design-controls.css';

export default function TemplatePicker({ onApply }) {
  const [selectedId, setSelectedId] = useState(CARD_TEMPLATES[0].id);
  const [appliedName, setAppliedName] = useState('');

  function applyTemplate() {
    const template = CARD_TEMPLATES.find((choice) => choice.id === selectedId);
    if (!template) return;
    onApply(template);
    setAppliedName(template.name);
  }

  return (
    <section className="editor-section template-section" aria-label="Optional starter templates">
      <details className="advanced-controls">
        <summary>Choose a starter template <span className="optional-label">Optional</span></summary>
        <p className="field-note">A starting point for your words and design. Applying one replaces those choices; your recipient, photos and secret-code settings stay with your card.</p>
        <div className="template-controls">
          <div className="field-group">
            <label className="field-label" htmlFor="card-template">Starter template</label>
            <select className="text-input" id="card-template" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {CARD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </div>
          <button className="apply-template-button" type="button" onClick={applyTemplate}>Apply template</button>
        </div>
      </details>
      <p className="template-applied" role="status">{appliedName ? `${appliedName} applied. Every detail is still yours to edit.` : ''}</p>
    </section>
  );
}

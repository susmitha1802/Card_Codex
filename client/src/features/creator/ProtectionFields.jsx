import './protection-fields.css';

export default function ProtectionFields({ protection, onChange }) {
  function updateHint(index, value) {
    // Replace just the edited hint while keeping React state immutable.
    const nextHints = protection.hints.map((hint, hintIndex) => (
      hintIndex === index ? value : hint
    ));
    onChange('hints', nextHints);
  }

  return (
    <section className="editor-section protection-section" aria-labelledby="protection-heading">
      <div className="section-heading">
        <span className="section-number" aria-hidden="true">05</span>
        <h2 className="section-title" id="protection-heading">
          Protect your card <span aria-hidden="true">🔐</span>
        </h2>
      </div>
      <p className="section-description">
        Keep your words a little surprise until they enter your code.
      </p>

      <label className="protection-toggle" htmlFor="protection-enabled">
        <span className="protection-toggle-label">
          Use a secret code <span className="optional-label">Optional</span>
        </span>
        <span className="protection-toggle-control">
          <span className="protection-switch">
            <input
              className="protection-switch-input"
              id="protection-enabled"
              type="checkbox"
              role="switch"
              checked={protection.enabled}
              aria-checked={protection.enabled}
              onChange={(event) => onChange('enabled', event.target.checked)}
            />
            <span className="protection-switch-track" aria-hidden="true" />
          </span>
          <span className="protection-toggle-status" aria-hidden="true">
            {protection.enabled ? 'ON' : 'OFF'}
          </span>
        </span>
      </label>

      {protection.enabled && (
        <div className="protection-fields">
          <div className="field-group">
            <label className="field-label" htmlFor="protection-code">Secret code</label>
            <input
              className="text-input"
              id="protection-code"
              name="secretCode"
              type="password"
              autoComplete="new-password"
              autoCapitalize="off"
              spellCheck={false}
              required
              minLength={8}
              maxLength={256}
              aria-describedby="protection-code-note"
              value={protection.code}
              onChange={(event) => onChange('code', event.target.value)}
            />
            <p className="field-note" id="protection-code-note">
              Use 8–128 characters. Codes are case-sensitive.
            </p>
          </div>

          {protection.hints.map((hint, index) => (
            <div className="field-group" key={index}>
              <label className="field-label" htmlFor={`protection-hint-${index + 1}`}>
                Hint {index + 1} <span className="optional-label">Optional</span>
              </label>
              <input
                className="text-input"
                id={`protection-hint-${index + 1}`}
                name={`hint${index + 1}`}
                type="text"
                autoComplete="off"
                maxLength={200}
                aria-describedby="protection-hints-note"
                value={hint}
                onChange={(event) => updateHint(index, event.target.value)}
              />
            </div>
          ))}
          <p className="field-note" id="protection-hints-note">
            Hints are visible before unlocking. Keep the code out of your hints.
          </p>
        </div>
      )}
    </section>
  );
}

import { STICKERS, STICKER_POSITIONS } from '../../../../shared/mediaOptions.js';
import { STICKER_ROTATIONS, STICKER_SIZES } from '../../../../shared/designOptions.js';
import './stickers-fields.css';

export default function StickersFields({ stickers, onChange }) {
  function updateSticker(index, field, value) {
    onChange(stickers.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function addSticker(id) {
    const position = STICKER_POSITIONS.find((choice) => !stickers.some((item) => item.position === choice.id));
    if (position) onChange([...stickers, { id, position: position.id }]);
  }

  return (
    <section className="editor-section stickers-section" aria-labelledby="stickers-heading">
      <div className="section-heading">
        <span className="section-number" aria-hidden="true">07</span>
        <h2 className="section-title" id="stickers-heading">Little extras <span className="optional-label">Optional</span></h2>
      </div>
      <p className="section-description">Add a sticker or two. There’s room for one in each of five positions.</p>
      <div className="sticker-picker" aria-label="Built-in stickers">
        {STICKERS.map((sticker) => <button type="button" key={sticker.id} aria-label={`Add ${sticker.label} sticker`}
          disabled={stickers.length >= 5} onClick={() => addSticker(sticker.id)}>{sticker.emoji}</button>)}
      </div>
      {stickers.length > 0 && <ul className="selected-stickers">
        {stickers.map((item, index) => {
          const sticker = STICKERS.find((choice) => choice.id === item.id);
          return <li key={index}>
            <span className="selected-sticker-emoji" role="img" aria-label={sticker.label}>{sticker.emoji}</span>
            <div className="selected-sticker-controls">
              <label>Position
                <select aria-label={`Position of sticker ${index + 1}`} value={item.position}
                  onChange={(event) => updateSticker(index, 'position', event.target.value)}>
                  {STICKER_POSITIONS.map((choice) => <option key={choice.id} value={choice.id}
                    disabled={stickers.some((current, itemIndex) => itemIndex !== index && current.position === choice.id)}>{choice.label}</option>)}
                </select>
              </label>
              <label>Size
                <select aria-label={`Size of sticker ${index + 1}`} value={item.size ?? 'medium'}
                  onChange={(event) => updateSticker(index, 'size', event.target.value)}>
                  {STICKER_SIZES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                </select>
              </label>
              <label>Rotation
                <select aria-label={`Rotation of sticker ${index + 1}`} value={item.rotation ?? 0}
                  onChange={(event) => updateSticker(index, 'rotation', Number(event.target.value))}>
                  {STICKER_ROTATIONS.map((rotation) => <option key={rotation} value={rotation}>
                    {rotation === 0 ? 'Upright' : rotation < 0 ? `${Math.abs(rotation)}° left` : `${rotation}° right`}
                  </option>)}
                </select>
              </label>
            </div>
            <button type="button" aria-label={`Remove sticker ${index + 1}`} onClick={() => onChange(stickers.filter((_item, itemIndex) => itemIndex !== index))}>Remove</button>
          </li>;
        })}
      </ul>}
    </section>
  );
}

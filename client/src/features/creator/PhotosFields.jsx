import { useRef } from 'react';
import './photos-fields.css';

export default function PhotosFields({ photos, error, onAdd, onRemove, onMove }) {
  const input = useRef(null);
  return (
    <section className="editor-section photos-section" aria-labelledby="photos-heading">
      <div className="section-heading">
        <span className="section-number" aria-hidden="true">06</span>
        <h2 className="section-title" id="photos-heading">Photos <span className="optional-label">Optional</span></h2>
      </div>
      <p className="section-description">A little memory to go with your words. Up to four photos, 5 MiB each.</p>
      <input ref={input} id="card-photos" className="sr-only" aria-label="Add photos" type="file"
        accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => {
          onAdd(Array.from(event.target.files));
          event.target.value = '';
        }} />
      <button className="add-photos-button" type="button" onClick={() => input.current?.click()} disabled={photos.length >= 4}>
        + Add Photos
      </button>
      <p className="field-note">JPEG, PNG, or WebP. Files upload only when you create your card.</p>
      {error && <p className="photo-field-error" role="alert">{error}</p>}
      {photos.length > 0 && <ol className="selected-photos">
        {photos.map((photo, index) => <li key={photo.id}>
          <img src={photo.url} alt={`Selected photo ${index + 1}`} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
          <div className="selected-photo-details">
            <p title={photo.file.name}>{photo.file.name}</p>
            <div className="photo-order-controls">
              <button type="button" disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`} onClick={() => onMove(photo.id, -1)}>↑</button>
              <button type="button" disabled={index === photos.length - 1} aria-label={`Move photo ${index + 1} later`} onClick={() => onMove(photo.id, 1)}>↓</button>
              <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => onRemove(photo.id)}>Remove</button>
            </div>
          </div>
        </li>)}
      </ol>}
    </section>
  );
}

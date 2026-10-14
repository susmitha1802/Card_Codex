import { useRef, useState } from 'react';
import './photo-gallery.css';

function Photo({ photo, index, onPhotoError }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reportedAttempt = useRef(-1);
  function handleError() {
    setFailed(true);
    if (reportedAttempt.current === attempt) return;
    reportedAttempt.current = attempt;
    onPhotoError?.(photo.id);
  }
  return (
    <figure className="card-photo">
      {failed ? <div className="photo-unavailable" role="status">
        <span className="photo-unavailable-icon" aria-hidden="true">▧</span>
        <p>This photo couldn’t be loaded.</p>
        <button className="photo-retry" type="button" onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>Retry photo</button>
      </div> : (
        <img key={attempt} src={photo.url} alt={`Card photo ${index + 1}`} onError={handleError} />
      )}
    </figure>
  );
}

// Both local previews and saved recipient photos use this small gallery.
export default function PhotoGallery({ photos, layout = 'gallery', onPhotoError }) {
  if (!photos?.length) return null;
  return (
    <div className={`card-photo-gallery${photos.length === 1 ? ' single-photo' : ''}`} data-photo-layout={layout} aria-label="Card photos">
      {photos.map((photo, index) => <Photo key={`${photo.id}:${photo.url}`} photo={photo} index={index} onPhotoError={onPhotoError} />)}
    </div>
  );
}

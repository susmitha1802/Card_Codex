import { useEffect, useRef, useState } from 'react';
import { PHOTO_LIMITS } from '../../../../shared/mediaOptions.js';

// Object URLs show local files immediately. They are never sent to the server.
export default function usePhotos() {
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const currentPhotos = useRef([]);

  function update(next) {
    currentPhotos.current = next;
    setPhotos(next);
  }

  useEffect(() => () => {
    currentPhotos.current.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, []);

  function addPhotos(files) {
    setPhotoError('');
    if (files.length + currentPhotos.current.length > PHOTO_LIMITS.maxFiles) {
      setPhotoError('Choose up to four photos. Remove one before adding more.');
      return;
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setPhotoError('Choose JPEG, PNG, or WebP photos. Other formats aren’t supported.');
      return;
    }
    if (files.some((file) => file.size > PHOTO_LIMITS.maxBytes || !file.size)) {
      setPhotoError('Each photo must be non-empty and no larger than 5 MiB.');
      return;
    }
    update([...currentPhotos.current, ...files.map((file) => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file),
    }))]);
  }

  function removePhoto(id) {
    const photo = currentPhotos.current.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    update(currentPhotos.current.filter((item) => item.id !== id));
    setPhotoError('');
  }

  function movePhoto(id, direction) {
    const next = [...currentPhotos.current];
    const index = next.findIndex((photo) => photo.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  }

  function clearPhotos() {
    currentPhotos.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    update([]);
    setPhotoError('');
  }

  return { photos, photoError, addPhotos, removePhoto, movePhoto, clearPhotos };
}

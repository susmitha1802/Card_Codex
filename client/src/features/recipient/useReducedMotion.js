import { useEffect, useState } from 'react';

const preference = '(prefers-reduced-motion: reduce)';

function currentPreference() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(preference).matches
    : false;
}

// Read the initial preference before rendering, so reduced-motion visitors
// never briefly see an animated envelope. Changes also apply to an open card.
export default function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(currentPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(preference);
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

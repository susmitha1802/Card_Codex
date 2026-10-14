// Small, named choices keep the editor approachable and the API predictable.
// Background CSS is built in here; a browser request never supplies CSS or URLs.
export const BACKGROUNDS = [
  { id: 'theme', label: 'Theme background', category: 'Theme' },
  { id: 'cream', label: 'Warm cream', category: 'Solid', css: '#fff8ec', colors: ['#fff8ec'], ink: '#273247' },
  { id: 'rose', label: 'Blush rose', category: 'Solid', css: '#fff0f4', colors: ['#fff0f4'], ink: '#593449' },
  { id: 'midnight', label: 'Midnight ink', category: 'Solid', css: '#20273b', colors: ['#20273b'], ink: '#fff8ec' },
  { id: 'dawn', label: 'Peach dawn', category: 'Gradient', css: 'linear-gradient(145deg, #fff0e8, #f4e6ff)', colors: ['#fff0e8', '#f4e6ff'], ink: '#45334f' },
  { id: 'ocean', label: 'Quiet ocean', category: 'Gradient', css: 'linear-gradient(145deg, #e8f4ff, #e7f7ef)', colors: ['#e8f4ff', '#e7f7ef'], ink: '#294e58' },
  { id: 'dots', label: 'Paper dots', category: 'Pattern', css: 'radial-gradient(#ded5c4 0.8px, transparent 0.8px) 0 0 / 14px 14px, #fff8ec', colors: ['#fff8ec', '#ded5c4'], ink: '#273247' },
  { id: 'linen', label: 'Soft linen', category: 'Pattern', css: 'repeating-linear-gradient(0deg, #f6f0fa 0 7px, #e9e0ef 7px 8px)', colors: ['#f6f0fa', '#e9e0ef'], ink: '#45334f' },
];

export const CARD_LAYOUTS = [
  { id: 'centered', label: 'Classic centered' },
  { id: 'title', label: 'A bold little title' },
  { id: 'photo', label: 'Photo + message' },
  { id: 'collage', label: 'Photo collage' },
  { id: 'letter', label: 'A personal letter' },
];

export const PHOTO_LAYOUTS = [
  { id: 'gallery', label: 'Simple gallery' },
  { id: 'hero', label: 'Hero photo + gallery' },
  { id: 'split', label: 'Two-photo split' },
  { id: 'stacked', label: 'Stacked memories' },
];

export const TEXT_WEIGHTS = [
  { id: 'normal', label: 'Regular', value: 400 },
  { id: 'medium', label: 'Medium', value: 500 },
  { id: 'bold', label: 'Bold', value: 700 },
];

export const LINE_SPACINGS = [
  { id: 'comfortable', label: 'Comfortable', value: 1.7 },
  { id: 'airy', label: 'Airy', value: 2 },
];

export const DECORATIONS = [
  { id: 'none', label: 'Theme details only' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'stars', label: 'Stars' },
  { id: 'sparkles', label: 'Sparkles' },
  { id: 'petals', label: 'Petals' },
  { id: 'balloons', label: 'Balloons' },
  { id: 'confetti', label: 'Confetti' },
  { id: 'lines', label: 'Fine lines' },
  { id: 'dots', label: 'Little dots' },
];

export const STICKER_SIZES = [
  { id: 'small', label: 'Small', value: 24 },
  { id: 'medium', label: 'Medium', value: 30 },
  { id: 'large', label: 'Large', value: 40 },
];
export const STICKER_ROTATIONS = [-15, 0, 15];

export const DESIGN_DEFAULTS = Object.freeze({
  background: 'theme', layout: 'centered', photoLayout: 'gallery',
  textWeight: 'normal', lineSpacing: 'comfortable', decorations: 'none',
});

export const DESIGN_CHOICES = {
  background: BACKGROUNDS, layout: CARD_LAYOUTS, photoLayout: PHOTO_LAYOUTS,
  textWeight: TEXT_WEIGHTS, lineSpacing: LINE_SPACINGS, decorations: DECORATIONS,
};

// Rendering is tolerant of an older or damaged stored setting. API validation
// is stricter: unsupported submitted settings are rejected on the server.
export function normalizeDesign(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(Object.entries(DESIGN_DEFAULTS).map(([key, fallback]) => [
    key, DESIGN_CHOICES[key].some((choice) => choice.id === source[key]) ? source[key] : fallback,
  ]));
}

export function compactDesign(input) {
  return Object.fromEntries(Object.entries(normalizeDesign(input)).filter(([key, value]) => value !== DESIGN_DEFAULTS[key]));
}

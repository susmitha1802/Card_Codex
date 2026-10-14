// Keeping these options in one place lets the editor and preview agree.
export const OCCASIONS = [
  { id: 'birthday', label: 'Birthday', emoji: '🎂', defaultTitle: 'Happy Birthday' },
  { id: 'missing-you', label: 'Missing You', emoji: '💕', defaultTitle: 'Wish you were here' },
  { id: 'sorry', label: 'Sorry', emoji: '🥹', defaultTitle: 'From the heart' },
  { id: 'love', label: 'Love', emoji: '❤️', defaultTitle: 'You mean everything' },
  { id: 'friendship', label: 'Friendship', emoji: '🤝', defaultTitle: 'Better together' },
  { id: 'thank-you', label: 'Thank You', emoji: '🙏', defaultTitle: 'A little thank you' },
  { id: 'congratulations', label: 'Congratulations', emoji: '🎉', defaultTitle: 'Look at you shine' },
  { id: 'anniversary', label: 'Anniversary', emoji: '💐', defaultTitle: 'Another year of us' },
  { id: 'get-well-soon', label: 'Get Well Soon', emoji: '🫂', defaultTitle: 'Brighter days ahead' },
  { id: 'farewell', label: 'Farewell', emoji: '🎓', defaultTitle: 'On to your next chapter' },
  { id: 'just-because', label: 'Just Because', emoji: '✨', defaultTitle: 'Just a little joy' },
  { id: 'custom', label: 'Custom', emoji: '📝', defaultTitle: 'A note for you' },
];

export const THEMES = [
  {
    id: 'romantic', name: 'Romantic', description: 'Warm rose & tender details',
    textColor: '#fff1e7', fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'birthday', name: 'Birthday', description: 'Playful blue & little surprises',
    textColor: '#173f8b', fontFamily: '"Segoe UI", Arial, sans-serif',
  },
  {
    id: 'pastel', name: 'Soft / Pastel', description: 'Dreamy lilac & soft shapes',
    textColor: '#403856', fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'elegant', name: 'Elegant', description: 'Quiet cream & timeless type',
    textColor: '#263a42', fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'dark', name: 'Dark / Emotional', description: 'Midnight tones & a little starlight',
    textColor: '#f1eafa', fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'celebration', name: 'Celebration', description: 'Vibrant violet & joyful confetti',
    textColor: '#fff6ea', fontFamily: '"Segoe UI", Arial, sans-serif',
  },
];

export const FONT_OPTIONS = [
  { id: 'theme', label: 'Theme default', fontFamily: null },
  { id: 'serif', label: 'Classic serif', fontFamily: 'Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Modern sans', fontFamily: '"Segoe UI", Arial, sans-serif' },
  { id: 'rounded', label: 'Playful rounded', fontFamily: '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif' },
  { id: 'handwritten', label: 'Handwritten', fontFamily: '"Segoe Print", "Bradley Hand", cursive' },
];

export const FONT_SIZES = [
  { id: 'small', label: 'Small', value: 16 },
  { id: 'medium', label: 'Medium', value: 20 },
  { id: 'large', label: 'Large', value: 24 },
];

export function getOccasion(id) {
  return OCCASIONS.find((occasion) => occasion.id === id) ?? OCCASIONS[0];
}

export function getTheme(id) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[1];
}

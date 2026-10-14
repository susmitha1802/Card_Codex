// Shared limits are convenient for the UI; the server always checks them again.
export const PHOTO_LIMITS = {
  maxFiles: 4,
  maxBytes: 5 * 1024 * 1024,
  maxPixels: 12000000,
  maxDimension: 8192,
  maxOutputDimension: 2400,
};

export const STICKERS = [
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'two-hearts', emoji: '💕', label: 'Two hearts' },
  { id: 'sparkling-heart', emoji: '💖', label: 'Sparkling heart' },
  { id: 'pleading', emoji: '🥹', label: 'Touched' },
  { id: 'hug', emoji: '🫂', label: 'Hug' },
  { id: 'birthday', emoji: '🎂', label: 'Birthday cake' },
  { id: 'party', emoji: '🎉', label: 'Celebration' },
  { id: 'sparkles', emoji: '✨', label: 'Sparkles' },
  { id: 'blossom', emoji: '🌸', label: 'Blossom' },
  { id: 'rose', emoji: '🌹', label: 'Rose' },
  { id: 'love-letter', emoji: '💌', label: 'Love letter' },
  { id: 'star', emoji: '⭐', label: 'Star' },
  { id: 'crying', emoji: '😭', label: 'Tears' },
  { id: 'smile', emoji: '😊', label: 'Smile' },
];

export const STICKER_POSITIONS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'center', label: 'Center' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

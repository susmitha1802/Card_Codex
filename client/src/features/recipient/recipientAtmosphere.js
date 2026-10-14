// A few bounded decorations give each theme its own movement. The card's
// actual colors and typography still come from the existing shared renderer.
const themeAtmospheres = {
  romantic: { motion: 'romantic', decoration: 'hearts', count: 2, openingMs: 580, messageMs: 340 },
  birthday: { motion: 'playful', decoration: 'confetti', count: 8, openingMs: 500, messageMs: 280 },
  pastel: { motion: 'soft', decoration: 'petals', count: 3, openingMs: 560, messageMs: 320 },
  elegant: { motion: 'restrained', decoration: 'line', count: 1, openingMs: 520, messageMs: 300 },
  dark: { motion: 'emotional', decoration: 'stars', count: 2, openingMs: 620, messageMs: 380 },
  celebration: { motion: 'festive', decoration: 'confetti', count: 6, openingMs: 450, messageMs: 250 },
};

export function getRecipientAtmosphere(card) {
  const theme = Object.hasOwn(themeAtmospheres, card?.theme) ? card.theme : 'birthday';
  const occasion = typeof card?.occasion === 'string' ? card.occasion : 'custom';
  const atmosphere = { ...themeAtmospheres[theme], theme, occasion };

  // Tender occasions should stay gentle even when a bright theme was chosen.
  if (['sorry', 'get-well-soon', 'farewell'].includes(occasion)) {
    return {
      ...atmosphere,
      motion: 'restrained',
      decoration: theme === 'dark' ? 'stars' : 'line',
      count: theme === 'dark' ? 2 : 1,
      openingMs: 600,
      messageMs: 360,
    };
  }
  if (occasion === 'missing-you') {
    return {
      ...atmosphere,
      motion: 'emotional',
      decoration: ['birthday', 'celebration'].includes(theme) ? 'stars' : atmosphere.decoration,
      count: ['birthday', 'celebration'].includes(theme) ? 2 : atmosphere.count,
      openingMs: 620,
      messageMs: 380,
    };
  }
  if (['love', 'anniversary'].includes(occasion)) {
    return {
      ...atmosphere,
      motion: 'romantic',
      decoration: ['dark', 'elegant'].includes(theme) ? atmosphere.decoration : 'hearts',
      count: theme === 'elegant' ? 1 : 2,
      openingMs: 580,
      messageMs: 340,
    };
  }
  if (['birthday', 'congratulations'].includes(occasion)
    && ['birthday', 'celebration'].includes(theme)) {
    atmosphere.motion = 'festive';
  }
  return atmosphere;
}

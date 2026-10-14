import { FONT_OPTIONS, FONT_SIZES, getTheme } from './cardOptions.js';
import { BACKGROUNDS, TEXT_WEIGHTS, LINE_SPACINGS, normalizeDesign } from './designOptions.js';

const validColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first, second) {
  if (!validColor(first) || !validColor(second)) return 0;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export function minimumContrast(ink, colors) {
  return Math.min(...colors.map((color) => contrastRatio(ink, color)));
}

// These samples correspond to the fixed theme backgrounds in card-preview.css.
// A low-contrast explicit ink is kept, with a contrasting reading surface.
const themeColors = {
  romantic: ['#672a3d', '#a44a61'], birthday: ['#fffaf0', '#e8f0fd'],
  pastel: ['#f1eafa', '#fff0eb', '#e6f3ed'], elegant: ['#fcf9f0'],
  dark: ['#1d2335', '#323951'], celebration: ['#965ecb', '#6845b8', '#48349d'],
};

/** The creator and recipient use this same small, computed rendering model. */
export function resolveCardDesign(card, photoCount = 0) {
  const theme = getTheme(card.theme);
  const design = normalizeDesign(card.design);
  const selected = BACKGROUNDS.find((choice) => choice.id === design.background);
  const background = selected?.id === 'theme' ? null : selected;
  const requestedColor = validColor(card.textColor) ? card.textColor : theme.textColor;
  let textColor = requestedColor;
  let readabilitySurface = null;

  if (background && minimumContrast(requestedColor, background.colors) < 4.5) {
    textColor = background.ink;
  } else if (!background && validColor(card.textColor)
    && minimumContrast(requestedColor, themeColors[theme.id]) < 4.5) {
    // One of pure white or black always gives sufficient contrast with a
    // six-digit color. This preserves older cards' explicitly chosen ink.
    readabilitySurface = contrastRatio(requestedColor, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
  }

  const photoBased = ['photo', 'collage'].includes(design.layout);
  return {
    design, background,
    effectiveLayout: photoBased && photoCount === 0 ? 'centered' : design.layout,
    photoLayout: design.photoLayout,
    fontFamily: FONT_OPTIONS.find((choice) => choice.id === card.font)?.fontFamily || theme.fontFamily,
    fontSize: FONT_SIZES.find((choice) => choice.id === card.fontSize)?.value ?? 20,
    textWeight: TEXT_WEIGHTS.find((choice) => choice.id === design.textWeight).value,
    lineHeight: LINE_SPACINGS.find((choice) => choice.id === design.lineSpacing).value,
    textColor,
    effectiveColorAdjusted: textColor !== requestedColor,
    readabilitySurface,
  };
}

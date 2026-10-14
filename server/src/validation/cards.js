import { OCCASIONS, THEMES, FONT_OPTIONS, FONT_SIZES } from '../../../shared/cardOptions.js';
import { isValidSecretCode } from '../security/secret-codes.js';
import { STICKERS, STICKER_POSITIONS } from '../../../shared/mediaOptions.js';
import {
  BACKGROUNDS, CARD_LAYOUTS, PHOTO_LAYOUTS, TEXT_WEIGHTS, LINE_SPACINGS,
  DECORATIONS, STICKER_SIZES, STICKER_ROTATIONS, DESIGN_DEFAULTS,
} from '../../../shared/designOptions.js';

const occasionIds = new Set(OCCASIONS.map((option) => option.id));
const themeIds = new Set(THEMES.map((option) => option.id));
const fontIds = new Set(FONT_OPTIONS.map((option) => option.id));
const fontSizeIds = new Set(FONT_SIZES.map((option) => option.id));
const alignments = new Set(['left', 'center', 'right']);
const allowedFields = new Set([
  'occasion', 'recipientName', 'title', 'message', 'theme',
  'font', 'fontSize', 'alignment', 'textColor',
  'protection', 'stickers', 'design',
]);
const protectionFields = new Set(['enabled', 'code', 'hints']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

const stickerIds = new Set(STICKERS.map((sticker) => sticker.id));
const stickerPositions = new Set(STICKER_POSITIONS.map((position) => position.id));
const stickerSizes = new Set(STICKER_SIZES.map((size) => size.id));
const stickerRotations = new Set(STICKER_ROTATIONS);
const stickerFields = new Set(['id', 'position', 'size', 'rotation']);
const designChoices = {
  background: new Set(BACKGROUNDS.map((choice) => choice.id)),
  layout: new Set(CARD_LAYOUTS.map((choice) => choice.id)),
  photoLayout: new Set(PHOTO_LAYOUTS.map((choice) => choice.id)),
  textWeight: new Set(TEXT_WEIGHTS.map((choice) => choice.id)),
  lineSpacing: new Set(LINE_SPACINGS.map((choice) => choice.id)),
  decorations: new Set(DECORATIONS.map((choice) => choice.id)),
};

// Senders choose built-in settings, never CSS, HTML, image URLs, or arbitrary JSON.
function validateDesign(input, fields) {
  if (input === undefined) return {};
  if (!isPlainObject(input)) {
    fields.design = 'Choose the built-in card design settings.';
    return {};
  }
  if (Object.keys(input).some((field) => !Object.hasOwn(designChoices, field))) {
    fields.design = 'Only the supported card design settings can be saved.';
  }
  const design = {};
  for (const [field, defaultValue] of Object.entries(DESIGN_DEFAULTS)) {
    const value = input[field] === undefined ? defaultValue : input[field];
    if (typeof value !== 'string' || !designChoices[field].has(value)) {
      fields.design = 'Choose the built-in card design settings.';
    } else if (value !== defaultValue) {
      design[field] = value;
    }
  }
  return design;
}

// Old or damaged rows keep valid choices and fall back individually for the rest.
function publicDesignFromStored(input) {
  if (!isPlainObject(input)) return {};
  const design = {};
  for (const [field, defaultValue] of Object.entries(DESIGN_DEFAULTS)) {
    if (typeof input[field] === 'string' && designChoices[field].has(input[field])
      && input[field] !== defaultValue) design[field] = input[field];
  }
  return design;
}

function validateStickers(input, fields) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 5 || input.some((sticker) => !isPlainObject(sticker)
    || Object.keys(sticker).some((field) => !stickerFields.has(field))
    || !Object.hasOwn(sticker, 'id') || !Object.hasOwn(sticker, 'position')
    || !stickerIds.has(sticker.id) || !stickerPositions.has(sticker.position)
    || (sticker.size !== undefined && !stickerSizes.has(sticker.size))
    || (sticker.rotation !== undefined && (typeof sticker.rotation !== 'number' || !stickerRotations.has(sticker.rotation))))
    || new Set(input.map((sticker) => sticker.position)).size !== input.length) {
    fields.stickers = 'Choose up to five built-in stickers, with one sticker in each position.';
    return [];
  }
  return input.map(({ id, position, size, rotation }) => ({
    id, position,
    ...(size !== undefined && size !== 'medium' ? { size } : {}),
    ...(rotation !== undefined && rotation !== 0 ? { rotation } : {}),
  }));
}

// Hints are deliberately public. Never build hints from the secret code.
export function publicHintsFromRow(value) {
  let hints = value;
  if (typeof hints === 'string') {
    try { hints = JSON.parse(hints); } catch { return []; }
  }
  if (!Array.isArray(hints)) return [];
  return hints.filter((hint) => typeof hint === 'string' && hint.trim()
    && Array.from(hint.trim()).length <= 200).slice(0, 2).map((hint) => hint.trim());
}

function validateProtection(input, fields) {
  const disabled = { enabled: false, code: null, hints: [] };
  if (input === undefined) return disabled;
  if (!isPlainObject(input) || typeof input.enabled !== 'boolean') {
    fields.protection = 'Choose whether to protect your card.';
    return disabled;
  }
  if (Object.keys(input).some((field) => !protectionFields.has(field))) {
    fields.protection = 'Only the supported protection settings can be saved.';
  }
  if (!input.enabled) return disabled;

  if (!isValidSecretCode(input.code)) {
    fields.code = 'Use a secret code with 8 to 128 characters that is not blank.';
  }
  const hints = input.hints === undefined ? [] : input.hints;
  if (!Array.isArray(hints) || hints.length > 2
    || hints.some((hint) => typeof hint !== 'string' || Array.from(hint.trim()).length > 200)) {
    fields.hints = 'Add up to two text hints, each with 200 characters or fewer.';
  }
  return { enabled: true, code: input.code, hints: publicHintsFromRow(hints) };
}

export function validateUnlockInput(input) {
  return isPlainObject(input) && Object.keys(input).length === 1
    && Object.hasOwn(input, 'code') && isValidSecretCode(input.code);
}

export function isShareToken(value) {
  return typeof value === 'string' && value.length === 32 && /^[A-Za-z0-9_-]{32}$/.test(value);
}

// Validate each editable value. The browser cannot set database or stored hashes.
export function validateCardInput(input) {
  const fields = {};
  if (!isPlainObject(input)) {
    return { valid: false, fields: { details: 'Send the card details as an object.' } };
  }

  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    fields.details = 'Only the supported card details can be saved.';
  }

  function choice(field, options, message, defaultValue) {
    const value = input[field] === undefined ? defaultValue : input[field];
    if (typeof value !== 'string' || !options.has(value)) fields[field] = message;
    return value;
  }

  function optionalText(field, maximum, label) {
    const value = input[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      fields[field] = `${label} must be text.`;
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > maximum) fields[field] = `Keep ${label.toLowerCase()} to ${maximum} characters or fewer.`;
    return trimmed || null;
  }

  const occasion = choice('occasion', occasionIds, 'Choose one of the available occasions.');
  const theme = choice('theme', themeIds, 'Choose one of the available themes.');
  const font = choice('font', fontIds, 'Choose one of the available fonts.', 'theme');
  const fontSize = choice('fontSize', fontSizeIds, 'Choose small, medium, or large text.', 'medium');
  const alignment = choice('alignment', alignments, 'Choose left, center, or right alignment.', 'center');
  const title = optionalText('title', 200, 'Card title');
  const recipientName = optionalText('recipientName', 100, 'Recipient name');
  const protection = validateProtection(input.protection, fields);
  const stickers = validateStickers(input.stickers, fields);
  const design = validateDesign(input.design, fields);

  if (typeof input.message !== 'string' || !input.message.trim()) {
    fields.message = 'Write a message for your card.';
  } else if (input.message.length > 10000) {
    fields.message = 'Keep your message to 10,000 characters or fewer.';
  }

  let textColor = input.textColor ?? null;
  if (textColor !== null) {
    if (typeof textColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(textColor)) {
      fields.textColor = 'Choose a color in the form #RRGGBB, or use the theme color.';
    } else {
      textColor = textColor.toLowerCase();
    }
  }

  if (Object.keys(fields).length) return { valid: false, fields };
  return {
    valid: true,
    fields,
    card: {
      occasion,
      title,
      recipientName,
      message: input.message,
      theme,
      customization: {
        font, fontSize, alignment, textColor,
        ...(stickers.length ? { stickers } : {}),
        ...(Object.keys(design).length ? { design } : {}),
      },
      protection,
    },
  };
}

// Older rows can have no customization. Only known, valid appearance values are used.
export function publicCardFromRow(row) {
  let appearance = row.customization;
  if (typeof appearance === 'string') {
    try {
      appearance = JSON.parse(appearance);
    } catch {
      appearance = null;
    }
  }
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) appearance = {};
  const stickers = validateStickers(appearance.stickers, {});
  const design = publicDesignFromStored(appearance.design);

  const result = validateCardInput({
    occasion: row.occasion,
    title: row.title,
    recipientName: row.recipient_name,
    message: row.message,
    theme: row.theme,
    font: fontIds.has(appearance.font) ? appearance.font : 'theme',
    fontSize: fontSizeIds.has(appearance.fontSize) ? appearance.fontSize : 'medium',
    alignment: alignments.has(appearance.alignment) ? appearance.alignment : 'center',
    textColor: typeof appearance.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(appearance.textColor)
      ? appearance.textColor : null,
    stickers,
    design,
  });

  if (!result.valid) return null;
  const { card } = result;
  return {
    occasion: card.occasion,
    title: card.title ?? '',
    recipientName: card.recipientName ?? '',
    message: card.message,
    theme: card.theme,
    ...card.customization,
  };
}

import { createHash } from 'node:crypto';
import { OCCASIONS, THEMES, FONT_OPTIONS, FONT_SIZES } from '../../shared/cardOptions.js';
import { DESIGN_CHOICES, STICKER_SIZES, STICKER_ROTATIONS } from '../../shared/designOptions.js';
import { STICKERS, STICKER_POSITIONS, PHOTO_LIMITS } from '../../shared/mediaOptions.js';

export const schemaVersion = 1;
export const schemaMigrationId = '002_embedded_cards_v1';
const choices = (values) => ({ bsonType: 'string', enum: values.map(({ id }) => id) });
const decimalId = { bsonType: 'string', pattern: '^(?:0|[1-9][0-9]{0,19})$' };
// mysql2 returns exact uint32 Numbers; the BSON driver stores values above the
// signed int32 range as doubles. Keep those lossless integers valid on import.
const uint = { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 4294967295, multipleOf: 1 };
const jsonValue = { bsonType: ['object', 'array', 'string', 'bool', 'int', 'long', 'double', 'decimal', 'null'] };
const nullableText = (maximum) => ({ bsonType: ['string', 'null'], maxLength: maximum });
const mediaProperties = {
  media_id: { bsonType: 'string', minLength: 1, maxLength: 32 },
  storage_key: { bsonType: 'string', minLength: 1, maxLength: 64 },
  mime_type: { bsonType: 'string', minLength: 1, maxLength: 50 },
  size_bytes: uint, width: uint, height: uint,
  sort_order: { bsonType: ['int', 'long'], minimum: 0, maximum: 255 },
  created_at: { bsonType: 'date' },
  legacy_mysql_id: decimalId,
  legacy_mysql_card_id: decimalId,
  legacy_mongodb_id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
  legacy_mongodb_card_id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
};
const mediaSchema = {
  bsonType: 'object', additionalProperties: false,
  required: ['media_id', 'storage_key', 'mime_type', 'size_bytes', 'width', 'height', 'sort_order', 'created_at'],
  properties: mediaProperties,
};
const customizationSchema = {
  bsonType: ['object', 'null'], additionalProperties: false,
  required: ['font', 'fontSize', 'alignment', 'textColor'],
  properties: {
    font: choices(FONT_OPTIONS), fontSize: choices(FONT_SIZES),
    alignment: { enum: ['left', 'center', 'right'] },
    textColor: { bsonType: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' },
    design: {
      bsonType: 'object', additionalProperties: false,
      properties: Object.fromEntries(Object.entries(DESIGN_CHOICES).map(([key, values]) => [key, choices(values)])),
    },
    stickers: {
      bsonType: 'array', maxItems: 5,
      items: {
        bsonType: 'object', required: ['id', 'position'], additionalProperties: false,
        properties: {
          id: choices(STICKERS), position: choices(STICKER_POSITIONS), size: choices(STICKER_SIZES),
          rotation: { bsonType: ['int', 'long', 'double'], enum: STICKER_ROTATIONS },
        },
      },
    },
  },
};
const uniqueMediaField = (field) => ({
  $eq: [
    { $size: '$media' },
    { $size: { $setUnion: [{ $map: { input: '$media', as: 'photo', in: `$$photo.${field}` } }, []] } },
  ],
});

export const mongoSchemaDefinitions = {
  cards: {
    validator: {
      $and: [{
        $jsonSchema: {
          bsonType: 'object', additionalProperties: false,
          required: ['_id', 'schema_version', 'share_token', 'occasion', 'title', 'message', 'recipient_name',
            'theme', 'customization', 'unlock_code_hash', 'unlock_hints', 'status', 'created_at', 'updated_at', 'expires_at', 'media'],
          properties: {
            _id: { bsonType: 'objectId' }, schema_version: { bsonType: 'int', enum: [schemaVersion] },
            share_token: { bsonType: 'string', minLength: 1, maxLength: 64 },
            occasion: { bsonType: 'string', maxLength: 50 }, title: nullableText(200),
            recipient_name: nullableText(100), message: { bsonType: 'string' },
            theme: { bsonType: 'string', maxLength: 50 }, customization: jsonValue,
            unlock_code_hash: { bsonType: ['string', 'null'], maxLength: 255 }, unlock_hints: jsonValue,
            status: { bsonType: 'string', maxLength: 20 },
            created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' }, expires_at: { bsonType: ['date', 'null'] },
            media: { bsonType: 'array', maxItems: PHOTO_LIMITS.maxFiles, items: mediaSchema },
            legacy_mysql_id: decimalId,
            legacy_mysql_status_value: { bsonType: 'string', maxLength: 20 },
            legacy_mysql_status_active: { bsonType: 'bool' },
            legacy_mongodb_imported: { bsonType: 'bool', enum: [true] },
          },
          oneOf: [
            { anyOf: [{ required: ['legacy_mysql_id'] }, { required: ['legacy_mongodb_imported'] }] },
            {
              not: { anyOf: [{ required: ['legacy_mysql_id'] }, { required: ['legacy_mongodb_imported'] },
                { required: ['legacy_mysql_status_value'] }, { required: ['legacy_mysql_status_active'] }] },
              properties: {
                share_token: { minLength: 32, maxLength: 32, pattern: '^[A-Za-z0-9_-]{32}$' }, occasion: choices(OCCASIONS), theme: choices(THEMES),
                message: { minLength: 1, maxLength: 10000 }, customization: customizationSchema,
                status: { enum: ['active', 'inactive'] },
                unlock_code_hash: { bsonType: ['string', 'null'], minLength: 181, maxLength: 181,
                  pattern: '^scrypt\\$v1\\$65536\\$8\\$2\\$[0-9a-f]{32}\\$[0-9a-f]{128}$' },
                unlock_hints: { bsonType: ['array', 'null'], maxItems: 2, items: { bsonType: 'string', maxLength: 200 } },
                media: {
                  items: {
                    not: { anyOf: [{ required: ['legacy_mysql_id'] }, { required: ['legacy_mysql_card_id'] },
                      { required: ['legacy_mongodb_id'] }, { required: ['legacy_mongodb_card_id'] }] },
                    properties: {
                      media_id: { minLength: 32, maxLength: 32, pattern: '^[A-Za-z0-9_-]{32}$' },
                      storage_key: { minLength: 37, maxLength: 37, pattern: '^[A-Za-z0-9_-]{32}\\.webp$' },
                      mime_type: { enum: ['image/webp'] }, size_bytes: { minimum: 1 },
                      width: { minimum: 1, maximum: PHOTO_LIMITS.maxOutputDimension },
                      height: { minimum: 1, maximum: PHOTO_LIMITS.maxOutputDimension }, sort_order: { maximum: 3 },
                    },
                  },
                },
              },
            },
          ],
        },
      }, {
        $expr: { $cond: [
          { $isArray: '$media' },
          { $and: ['media_id', 'storage_key', 'sort_order'].map(uniqueMediaField) },
          false,
        ] },
      }],
    },
    indexes: [
      { key: { share_token: 1 }, name: 'cards_share_token_unique', unique: true, collation: { locale: 'simple' } },
      { key: { 'media.media_id': 1 }, name: 'cards_media_id_unique', unique: true,
        partialFilterExpression: { 'media.media_id': { $exists: true } }, collation: { locale: 'simple' } },
      { key: { 'media.storage_key': 1 }, name: 'cards_media_storage_unique', unique: true,
        partialFilterExpression: { 'media.storage_key': { $exists: true } }, collation: { locale: 'simple' } },
      { key: { legacy_mysql_id: 1 }, name: 'cards_legacy_mysql_id_unique', unique: true,
        partialFilterExpression: { legacy_mysql_id: { $exists: true } }, collation: { locale: 'simple' } },
    ],
  },
};

// Object property order is immaterial in validators; array order still matters.
export function normalizeDefinition(value) {
  if (Array.isArray(value)) return value.map(normalizeDefinition);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, normalizeDefinition(value[key])]));
  return value;
}
export function equalDefinition(left, right) {
  return JSON.stringify(normalizeDefinition(left)) === JSON.stringify(normalizeDefinition(right));
}
export function stableSchemaChecksum(definitions = mongoSchemaDefinitions) {
  return createHash('sha256').update(JSON.stringify(normalizeDefinition(definitions))).digest('hex');
}
export function effectiveSimpleCollation(index, collectionOptions = {}) {
  return (index.collation ?? collectionOptions.collation ?? { locale: 'simple' }).locale === 'simple';
}
export function matchesRequiredIndex(actual, required, collectionOptions = {}) {
  return actual?.name === required.name && actual.unique === true && actual.sparse !== true
    && actual.hidden !== true && actual.expireAfterSeconds === undefined
    && JSON.stringify(actual.key) === JSON.stringify(required.key)
    && equalDefinition(actual.partialFilterExpression, required.partialFilterExpression)
    && effectiveSimpleCollation(actual, collectionOptions);
}

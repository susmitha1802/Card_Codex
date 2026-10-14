import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BSON, ObjectId } from 'mongodb';

export class ImportError extends Error {
  constructor(code = 'IMPORT_VALIDATION') {
    super('Import stopped. Review source compatibility, target conflicts, and staging configuration.');
    this.name = 'ImportError';
    this.code = code;
  }
}

export function decimalId(value) {
  const text = typeof value === 'bigint' ? value.toString() : String(value);
  if ((typeof value === 'number' && !Number.isSafeInteger(value))
    || !/^(?:0|[1-9][0-9]*)$/.test(text) || BigInt(text) > 18446744073709551615n) throw new ImportError();
  return text;
}

// Reject values BSON cannot preserve before a dry-run reports compatibility.
export function validateImportJson(value) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new ImportError();
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new ImportError();
    return;
  }
  if (Array.isArray(value)) { value.forEach(validateImportJson); return; }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new ImportError();
  for (const [key, item] of Object.entries(value)) {
    if (!key.isWellFormed() || key.includes('\0')) throw new ImportError();
    validateImportJson(item);
  }
}

export function validateImportSize(document) {
  if (BSON.calculateObjectSize(document) > 16 * 1024 * 1024) throw new ImportError();
  return document;
}

// mysql2 jsonStrings returns serialized JSON, including the quotes around a
// JSON string. Parse exactly once: a string containing JSON remains a string.
export function parseMysqlJson(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ImportError();
  try {
    const parsed = JSON.parse(value);
    const numericSignature = (lexical) => {
      const [coefficient, exponent = '0'] = lexical.toLowerCase().split('e');
      const [whole, fraction = ''] = coefficient.split('.');
      let digits = `${whole}${fraction}`.replace(/^-/, '').replace(/^0+/, '');
      let scale = BigInt(exponent) - BigInt(fraction.length);
      if (!digits) return '0';
      while (digits.endsWith('0')) { digits = digits.slice(0, -1); scale += 1n; }
      return `${lexical.startsWith('-') ? '-' : ''}${digits}e${scale}`;
    };
    // Skip quoted strings, then check each numeric token before its original
    // precision disappears in JavaScript/BSON. Unsupported values stop the
    // migration for review instead of silently changing the source JSON.
    for (const match of value.matchAll(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
      if (!match[1]) continue;
      const number = Number(match[1]);
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))
        || numericSignature(match[1]) !== numericSignature(String(number))) throw new ImportError();
    }
    validateImportJson(parsed);
    return parsed;
  } catch { throw new ImportError(); }
}

export function parseMysqlDate(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) throw new ImportError();
  const [base, fraction = ''] = value.split('.');
  // BSON dates have millisecond precision. Never silently round a source date.
  if (/[^0]/.test(fraction.slice(3))) throw new ImportError();
  const utc = `${base.replace(' ', 'T')}.${fraction.slice(0, 3).padEnd(3, '0')}Z`;
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== utc) throw new ImportError();
  return date;
}

function text(value, { nullable = false, maximum } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.isWellFormed()
    || (maximum !== undefined && [...value].length > maximum)) throw new ImportError();
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new ImportError();
  return value;
}

export function validateMedia(media) {
  if (!Array.isArray(media) || media.length > 4) throw new ImportError();
  for (const key of ['media_id', 'storage_key', 'sort_order']) {
    if (new Set(media.map((photo) => photo[key])).size !== media.length) throw new ImportError();
  }
  for (const photo of media) {
    if (text(photo.media_id).length !== 32 || !/^[A-Za-z0-9_-]{32}$/.test(photo.media_id)
      || text(photo.storage_key).length !== 37 || !/^[A-Za-z0-9_-]{32}\.webp$/.test(photo.storage_key)
      || photo.mime_type !== 'image/webp') throw new ImportError();
    integer(photo.size_bytes, 1, 4294967295);
    integer(photo.width, 1, 4294967295);
    integer(photo.height, 1, 4294967295);
    integer(photo.sort_order, 0, 255);
    if (!(photo.created_at instanceof Date) || !Number.isFinite(photo.created_at.getTime())) throw new ImportError();
  }
  return media.sort((a, b) => a.sort_order - b.sort_order);
}

export function mapMysqlCard(row, mediaRows, id = new ObjectId()) {
  const legacyId = decimalId(row.id);
  if (text(row.share_token).length !== 32 || !/^[A-Za-z0-9_-]{32}$/.test(row.share_token)) throw new ImportError();
  if (![0, 1, false, true].includes(row.status_active)) throw new ImportError();
  const media = mediaRows.map((photo) => {
    if (decimalId(photo.card_id) !== legacyId) throw new ImportError();
    return {
      media_id: photo.media_id, storage_key: photo.storage_key, mime_type: photo.mime_type,
      size_bytes: photo.size_bytes, width: photo.width, height: photo.height, sort_order: photo.sort_order,
      created_at: parseMysqlDate(photo.created_at),
      legacy_mysql_id: decimalId(photo.id), legacy_mysql_card_id: legacyId,
    };
  });
  const status = text(row.status, { maximum: 20 });
  return validateImportSize({
    _id: id, schema_version: 1, share_token: row.share_token,
    occasion: text(row.occasion, { maximum: 50 }), title: text(row.title, { nullable: true, maximum: 200 }),
    message: text(row.message), recipient_name: text(row.recipient_name, { nullable: true, maximum: 100 }),
    theme: text(row.theme, { maximum: 50 }), customization: parseMysqlJson(row.customization),
    unlock_code_hash: text(row.unlock_code_hash, { nullable: true, maximum: 255 }),
    unlock_hints: parseMysqlJson(row.unlock_hints), status,
    created_at: parseMysqlDate(row.created_at), updated_at: parseMysqlDate(row.updated_at),
    expires_at: parseMysqlDate(row.expires_at, true), media: validateMedia(media),
    legacy_mysql_id: legacyId, legacy_mysql_status_value: status,
    legacy_mysql_status_active: Boolean(row.status_active),
  });
}

export function sourceFingerprint(kind, identity) {
  // Identity deliberately excludes passwords, connection URIs, and card data.
  return createHash('sha256').update(JSON.stringify({ kind, ...identity })).digest('hex');
}

export function sameImportedCard(actual, expected) {
  const withoutId = ({ _id, ...rest }) => rest;
  return isDeepStrictEqual(withoutId(actual), withoutId(expected));
}

export async function inspectCardConflict(cards, document, { requireObjectId = false } = {}) {
  const matches = await cards.find({ $or: [
    { share_token: document.share_token },
    { _id: document._id },
    ...(document.legacy_mysql_id ? [{ legacy_mysql_id: document.legacy_mysql_id }] : []),
    ...document.media.flatMap((photo) => [{ 'media.media_id': photo.media_id }, { 'media.storage_key': photo.storage_key }]),
  ] }, { collation: { locale: 'simple' }, maxTimeMS: 5000 }).toArray();
  if (!matches.length) return false;
  if (matches.length !== 1 || !sameImportedCard(matches[0], document)
    || (requireObjectId && !matches[0]._id.equals(document._id))) throw new ImportError('IMPORT_CONFLICT');
  return true;
}

export async function prepareTarget(database, { sourceId, kind, apply, emptyAcknowledged, sourceHistory = [] }) {
  const checkpointId = `import_${kind}:${sourceId}`;
  const cards = database.collection('cards');
  const checkpoints = database.collection('schema_migrations');
  const checkpoint = await checkpoints.findOne({ _id: checkpointId });
  const count = await cards.countDocuments({}, { maxTimeMS: 5000 });
  const collections = await database.listCollections({}, { nameOnly: true }).toArray();
  if (collections.some(({ name }) => name === 'card_media')
    && await database.collection('card_media').countDocuments({}, { maxTimeMS: 5000 })) throw new ImportError('IMPORT_TARGET');
  if (count && (!checkpoint || checkpoint.kind !== `${kind}-import` || checkpoint.source_id !== sourceId)) throw new ImportError('IMPORT_TARGET');
  if (checkpoint && (checkpoint.source_id !== sourceId || checkpoint.kind !== `${kind}-import`)) throw new ImportError('IMPORT_TARGET');
  if (checkpoint && (!Number.isSafeInteger(checkpoint.card_count) || checkpoint.card_count < 0
    || !Number.isSafeInteger(checkpoint.media_count) || checkpoint.media_count < 0
    || !['running', 'complete'].includes(checkpoint.state)
    || (checkpoint.last_id === null && (checkpoint.card_count !== 0 || checkpoint.media_count !== 0))
    || (checkpoint.last_id !== null && (kind === 'mysql'
      ? !/^(?:0|[1-9][0-9]{0,19})$/.test(checkpoint.last_id) : !/^[0-9a-f]{24}$/.test(checkpoint.last_id))))) throw new ImportError('IMPORT_CHECKPOINT');
  if (apply && !checkpoint && !emptyAcknowledged) throw new ImportError('IMPORT_GUARD');
  if (checkpoint?.source_schema_history && !isDeepStrictEqual(checkpoint.source_schema_history, sourceHistory)) throw new ImportError('IMPORT_CONFLICT');
  const result = checkpoint ?? {
    _id: checkpointId, kind: `${kind}-import`, source_id: sourceId, last_id: null,
    card_count: 0, media_count: 0, state: 'running', updated_at: new Date(), source_schema_history: sourceHistory,
  };
  if (apply && !checkpoint) await checkpoints.insertOne(result, { writeConcern: { w: 'majority' } });
  return { cards, checkpoints, checkpoint: result };
}

export async function acknowledgeBatch(checkpoints, checkpoint, documents, { apply }) {
  if (!documents.length || !apply) return;
  const updated = {
    last_id: checkpoint.kind === 'mysql-import'
      ? documents.at(-1).legacy_mysql_id : documents.at(-1)._id.toHexString(),
    card_count: checkpoint.card_count + documents.length,
    media_count: checkpoint.media_count + documents.reduce((sum, card) => sum + card.media.length, 0),
    updated_at: new Date(), state: 'running',
  };
  const result = await checkpoints.updateOne(
    { _id: checkpoint._id, last_id: checkpoint.last_id }, { $set: updated }, { writeConcern: { w: 'majority' } },
  );
  if (result.matchedCount !== 1) throw new ImportError('IMPORT_CHECKPOINT');
  Object.assign(checkpoint, updated);
}

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { readConfig } from '../src/config-reader.js';
import { createDatabaseChecks } from '../src/database-checks.js';
import {
  ImportError, decimalId, validateMedia, validateImportJson, validateImportSize,
  sourceFingerprint, inspectCardConflict, prepareTarget, acknowledgeBatch,
} from './mysql-import-utils.js';

const cardFields = new Set([
  '_id', 'share_token', 'occasion', 'title', 'message', 'recipient_name', 'theme', 'customization',
  'unlock_code_hash', 'unlock_hints', 'status', 'created_at', 'updated_at', 'expires_at',
  'legacy_mysql_id', 'legacy_mysql_status_value', 'legacy_mysql_status_active',
]);
const mediaFields = new Set([
  '_id', 'card_id', 'media_id', 'storage_key', 'mime_type', 'size_bytes', 'width', 'height',
  'sort_order', 'created_at', 'legacy_mysql_id', 'legacy_mysql_card_id',
  'legacy_mongodb_id', 'legacy_mongodb_card_id',
]);

export function mapReferencedCard(row, mediaRows) {
  if (!(row._id instanceof ObjectId) || Object.keys(row).some((key) => !cardFields.has(key))
    || typeof row.share_token !== 'string' || row.share_token.length !== 32
    || !/^[A-Za-z0-9_-]{32}$/.test(row.share_token)) throw new ImportError();
  const requireText = (value, maximum, nullable = false) => {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || !value.isWellFormed()
      || (maximum !== undefined && [...value].length > maximum)) throw new ImportError();
  };
  requireText(row.occasion, 50); requireText(row.theme, 50); requireText(row.message);
  requireText(row.status, 20); requireText(row.unlock_code_hash, 255, true);
  validateImportJson(row.unlock_hints);
  const title = Object.hasOwn(row, 'title') ? row.title : null;
  const recipientName = Object.hasOwn(row, 'recipient_name') ? row.recipient_name : null;
  const customization = Object.hasOwn(row, 'customization') ? row.customization : null;
  requireText(title, 200, true); requireText(recipientName, 100, true); validateImportJson(customization);
  if (row.legacy_mysql_id !== undefined) decimalId(row.legacy_mysql_id);
  if (row.legacy_mysql_status_active !== undefined && typeof row.legacy_mysql_status_active !== 'boolean') throw new ImportError();
  if (row.legacy_mysql_status_value !== undefined) requireText(row.legacy_mysql_status_value, 20);
  for (const key of ['created_at', 'updated_at']) {
    if (!(row[key] instanceof Date) || !Number.isFinite(row[key].getTime())) throw new ImportError();
  }
  if (row.expires_at !== null && (!(row.expires_at instanceof Date) || !Number.isFinite(row.expires_at.getTime()))) throw new ImportError();
  const media = mediaRows.map((photo) => {
    if (!(photo._id instanceof ObjectId) || !(photo.card_id instanceof ObjectId) || !photo.card_id.equals(row._id)
      || Object.keys(photo).some((key) => !mediaFields.has(key))) throw new ImportError('IMPORT_ORPHAN');
    // The parent keeps its ObjectId. Preserve both former row identifiers as
    // private metadata while the existing public media_id remains unchanged.
    const { _id, card_id, ...metadata } = photo;
    return { ...metadata, legacy_mongodb_id: _id.toHexString(), legacy_mongodb_card_id: card_id.toHexString() };
  });
  return validateImportSize({ ...row, title, recipient_name: recipientName, customization,
    schema_version: 1, legacy_mongodb_imported: true, media: validateMedia(media) });
}

export function readReferencedSettings(env, args = []) {
  if (args.some((arg) => !['--apply', '--dry-run'].includes(arg))
    || (args.includes('--apply') && args.includes('--dry-run'))) throw new ImportError('IMPORT_CONFIGURATION');
  for (const name of ['SOURCE_MONGODB_URI', 'SOURCE_MONGODB_DB_NAME', 'MONGODB_URI', 'MONGODB_DB_NAME']) {
    if (typeof env[name] !== 'string' || !env[name]) throw new ImportError('IMPORT_CONFIGURATION');
  }
  // Separate database names are required even if the two URIs look different:
  // credentials and DNS aliases must never turn this into an in-place import.
  if (env.SOURCE_MONGODB_DB_NAME === env.MONGODB_DB_NAME) throw new ImportError('IMPORT_TARGET');
  const base = {
    ...env, NODE_ENV: env.NODE_ENV ?? 'test', PUBLIC_APP_ORIGIN: env.PUBLIC_APP_ORIGIN ?? 'https://import.invalid',
    MEDIA_DIRECTORY: env.MEDIA_DIRECTORY || resolve('server/storage/photos'), ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true',
  };
  const apply = args.includes('--apply');
  if (apply && (env.ALLOW_REFERENCED_IMPORT !== 'true' || env.SOURCE_MONGODB_WRITE_FROZEN !== 'true'
    || env.MONGODB_IMPORT_BACKUPS_CONFIRMED !== 'true' || env.MONGODB_IMPORT_TARGET_STAGING !== 'true'
    || !/_(?:staging|test)$/.test(env.MONGODB_DB_NAME))) throw new ImportError('IMPORT_GUARD');
  return {
    apply, emptyAcknowledged: env.MONGODB_IMPORT_TARGET_EMPTY === 'true',
    target: readConfig(base).database,
    source: readConfig({ ...base, MONGODB_URI: env.SOURCE_MONGODB_URI, MONGODB_DB_NAME: env.SOURCE_MONGODB_DB_NAME }).database,
  };
}

export async function importReferenced({ source, database, sourceId, apply = false, emptyAcknowledged = false, batchSize = 250 }) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new ImportError();
  const sourceCards = source.collection('cards'); const sourceMedia = source.collection('card_media');
  const sourceHistory = await source.collection('schema_migrations').find({}).sort({ _id: 1 }).toArray();
  const expected = { cards: await sourceCards.countDocuments({}), media: await sourceMedia.countDocuments({}) };
  const { cards, checkpoints, checkpoint } = await prepareTarget(database,
    { sourceId, kind: 'referenced', apply, emptyAcknowledged, sourceHistory });
  const originalCheckpoint = { ...checkpoint };
  let lastId; let prefixCards = 0; let prefixMedia = 0;
  const counts = { cards: 0, media: 0, inserted: 0, matching: 0 };
  try {
  while (true) {
    const rows = await sourceCards.find(lastId ? { _id: { $gt: lastId } } : {}, { maxTimeMS: 5000 }).sort({ _id: 1 }).limit(batchSize).toArray();
    if (!rows.length) break;
    if (rows.some((row, index) => !(row._id instanceof ObjectId)
      || ((index || lastId) && row._id.toHexString() <= (index ? rows[index - 1]._id : lastId).toHexString()))) throw new ImportError();
    const photos = await sourceMedia.find({ card_id: { $in: rows.map((row) => row._id) } }, { maxTimeMS: 5000 }).toArray();
    const byCard = new Map(rows.map((row) => [row._id.toHexString(), []]));
    for (const photo of photos) {
      if (!(photo.card_id instanceof ObjectId) || !byCard.has(photo.card_id.toHexString())) throw new ImportError('IMPORT_ORPHAN');
      byCard.get(photo.card_id.toHexString()).push(photo);
    }
    const documents = rows.map((row) => mapReferencedCard(row, byCard.get(row._id.toHexString())));
    const pending = []; const resumed = [];
    for (const document of documents) {
      const matching = await inspectCardConflict(cards, document, { requireObjectId: true });
      const inPrefix = originalCheckpoint.last_id !== null && document._id.toHexString() <= originalCheckpoint.last_id;
      if (inPrefix && !matching) throw new ImportError('IMPORT_CHECKPOINT');
      if (inPrefix) { prefixCards += 1; prefixMedia += document.media.length; }
      else { resumed.push(document); if (!matching) pending.push(document); }
      counts.cards += 1; counts.media += document.media.length;
      if (matching) counts.matching += 1;
    }
    if (apply && resumed.length) {
      if (pending.length) await cards.insertMany(pending, { ordered: true, writeConcern: { w: 'majority' } });
      await acknowledgeBatch(checkpoints, checkpoint, resumed, { apply });
      counts.inserted += pending.length;
    }
    lastId = rows.at(-1)._id;
  }
  if (counts.cards !== expected.cards || counts.media !== expected.media
    || prefixCards !== originalCheckpoint.card_count || prefixMedia !== originalCheckpoint.media_count
    || expected.cards !== await sourceCards.countDocuments({}) || expected.media !== await sourceMedia.countDocuments({})) throw new ImportError('IMPORT_PARITY');
  if (apply) {
    if (checkpoint.card_count !== counts.cards || checkpoint.media_count !== counts.media
      || counts.cards !== await cards.countDocuments({})) throw new ImportError('IMPORT_PARITY');
    await checkpoints.updateOne({ _id: checkpoint._id, last_id: checkpoint.last_id },
      { $set: { state: 'complete', updated_at: new Date() } }, { writeConcern: { w: 'majority' } });
  }
  return counts;
  } catch (error) {
    error.importCounts = { ...counts };
    throw error;
  }
}

export async function main(env = process.env, args = process.argv.slice(2)) {
  let sourceClient; let targetClient;
  try {
    const settings = readReferencedSettings(env, args);
    const open = async ({ uri, databaseName, queueLimit: _q, operationTimeoutMS: _t, ...options }) => {
      const client = new MongoClient(uri, { ...options, timeoutMS: 10000 });
      await client.connect(); return client;
    };
    sourceClient = await open(settings.source); targetClient = await open(settings.target);
    const database = targetClient.db(settings.target.databaseName);
    if (settings.apply) await createDatabaseChecks(database).checkSchema();
    // URI credentials are deliberately excluded from persisted source identity.
    const sourceId = sourceFingerprint('referenced', { database: settings.source.databaseName,
      hosts: sourceClient.options.srvHost ? [] : sourceClient.options.hosts.map((host) => host.toString()).sort(),
      srvHost: sourceClient.options.srvHost ?? null });
    const counts = await importReferenced({ source: sourceClient.db(settings.source.databaseName), database,
      sourceId, apply: settings.apply, emptyAcknowledged: settings.emptyAcknowledged });
    console.log(`${settings.apply ? 'Import complete' : 'Dry-run complete'}: ${counts.cards} cards, ${counts.media} photos, ${counts.matching} matching cards, ${counts.inserted} inserted cards.`);
  } catch (error) {
    const { cards = 0, media = 0 } = error.importCounts ?? {};
    console.error(`Referenced import stopped after validating ${cards} cards and ${media} photos. Review source compatibility, backups, frozen writes, staging guards, and conflicts.`);
    process.exitCode = 1;
  } finally {
    try { await sourceClient?.close(); } catch { process.exitCode = 1; }
    try { await targetClient?.close(); } catch { process.exitCode = 1; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  await main();
}

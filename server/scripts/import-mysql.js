import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { readConfig } from '../src/config-reader.js';
import { createDatabaseChecks } from '../src/database-checks.js';
import {
  ImportError, decimalId, mapMysqlCard, sourceFingerprint,
  inspectCardConflict, prepareTarget, acknowledgeBatch, parseMysqlDate,
} from './mysql-import-utils.js';

function required(env, name, allowEmpty = false) {
  if (typeof env[name] !== 'string' || (!allowEmpty && !env[name].length)) throw new ImportError('IMPORT_CONFIGURATION');
  return env[name];
}

export function readImportSettings(env, args = []) {
  if (args.some((arg) => !['--apply', '--dry-run'].includes(arg))
    || (args.includes('--apply') && args.includes('--dry-run'))) throw new ImportError('IMPORT_CONFIGURATION');
  const apply = args.includes('--apply');
  const host = required(env, 'MYSQL_SOURCE_HOST');
  const port = Number(env.MYSQL_SOURCE_PORT ?? 3306);
  const sslValue = env.MYSQL_SOURCE_SSL ?? 'false';
  if (!['true', 'false'].includes(sslValue) || !Number.isInteger(port) || port < 1 || port > 65535) throw new ImportError('IMPORT_CONFIGURATION');
  if (env.NODE_ENV === 'production' && !['localhost', '127.0.0.1', '::1'].includes(host)
    && sslValue !== 'true') throw new ImportError('IMPORT_TLS');
  const databaseName = required(env, 'MONGODB_DB_NAME');
  required(env, 'MONGODB_URI');
  const target = readConfig({
    ...env, NODE_ENV: env.NODE_ENV ?? 'test',
    PUBLIC_APP_ORIGIN: env.PUBLIC_APP_ORIGIN ?? 'https://import.invalid',
    MEDIA_DIRECTORY: env.MEDIA_DIRECTORY || resolve('server/storage/photos'),
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true',
  }).database;
  if (apply && (env.ALLOW_MYSQL_IMPORT !== 'true' || env.MYSQL_SOURCE_WRITE_FROZEN !== 'true'
    || env.MYSQL_IMPORT_BACKUPS_CONFIRMED !== 'true' || env.MONGODB_IMPORT_TARGET_STAGING !== 'true'
    || !/_(?:staging|test)$/.test(databaseName))) throw new ImportError('IMPORT_GUARD');
  return {
    apply, target, emptyAcknowledged: env.MONGODB_IMPORT_TARGET_EMPTY === 'true',
    source: {
      host, port, user: required(env, 'MYSQL_SOURCE_USER'),
      password: required(env, 'MYSQL_SOURCE_PASSWORD', true), database: required(env, 'MYSQL_SOURCE_DB_NAME'),
      connectTimeout: 5000, supportBigNumbers: true, bigNumberStrings: true,
      jsonStrings: true, dateStrings: true, timezone: 'Z', charset: 'UTF8MB4_UNICODE_CI',
      ssl: sslValue === 'true' ? { rejectUnauthorized: true, verifyIdentity: true } : undefined,
    },
    sourceCaFile: env.MYSQL_SOURCE_SSL_CA_FILE,
  };
}

export function createMysqlSource(connection) {
  return {
    async begin() {
      await connection.query("SET time_zone = '+00:00'");
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('SET TRANSACTION READ ONLY');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    },
    async history() {
      let rows;
      try { [rows] = await connection.query('SELECT * FROM schema_migrations'); }
      catch (error) { if (error.code === 'ER_NO_SUCH_TABLE') return []; throw error; }
      return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
        ['applied_at', 'created_at'].includes(key) && value !== null ? parseMysqlDate(value) : value,
      ]))).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    },
    async counts() {
      const [[row]] = await connection.query('SELECT CAST((SELECT COUNT(*) FROM cards) AS CHAR) AS cards, CAST((SELECT COUNT(*) FROM card_media) AS CHAR) AS media');
      const [[orphans]] = await connection.query('SELECT CAST(COUNT(*) AS CHAR) AS count FROM card_media m LEFT JOIN cards c ON c.id = m.card_id WHERE c.id IS NULL');
      if (BigInt(orphans.count) !== 0n) throw new ImportError('IMPORT_ORPHAN');
      const cards = Number(row.cards); const media = Number(row.media);
      if (!Number.isSafeInteger(cards) || !Number.isSafeInteger(media)) throw new ImportError();
      return { cards, media };
    },
    async cardsAfter(id, limit) {
      const [rows] = await connection.execute(
        `SELECT id, share_token, occasion, title, message, recipient_name, theme,
                customization, unlock_code_hash, unlock_hints, status, (status = 'active') AS status_active,
                created_at, updated_at, expires_at FROM cards WHERE id ${id === null ? '>=' : '>'} ? ORDER BY id LIMIT ?`,
        [id ?? '0', limit],
      );
      return rows;
    },
    async mediaFor(ids) {
      if (!ids.length) return [];
      const [rows] = await connection.execute(
        `SELECT id, media_id, card_id, storage_key, mime_type, size_bytes, width, height,
                sort_order, created_at FROM card_media WHERE card_id IN (${ids.map(() => '?').join(', ')})
                ORDER BY card_id, sort_order`, ids,
      );
      return rows;
    },
  };
}

export async function importMysql({ source, database, sourceId, apply = false, emptyAcknowledged = false, batchSize = 250 }) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new ImportError();
  await source.begin();
  const sourceHistory = await source.history();
  const expected = await source.counts();
  const { cards, checkpoints, checkpoint } = await prepareTarget(database,
    { sourceId, kind: 'mysql', apply, emptyAcknowledged, sourceHistory });
  const originalCheckpoint = { ...checkpoint };
  let lastId = null;
  const counts = { cards: 0, media: 0, inserted: 0, matching: 0 };
  let prefixCards = 0; let prefixMedia = 0;
  try {
  while (true) {
    const rows = await source.cardsAfter(lastId, batchSize);
    if (!rows.length) break;
    const ids = rows.map((row) => decimalId(row.id));
    if (ids.some((id, index) => {
      const previous = index ? ids[index - 1] : lastId;
      return previous !== null && BigInt(id) <= BigInt(previous);
    })) throw new ImportError();
    const photos = await source.mediaFor(ids);
    const byCard = new Map(ids.map((id) => [id, []]));
    for (const photo of photos) {
      const parent = byCard.get(decimalId(photo.card_id));
      if (!parent) throw new ImportError('IMPORT_ORPHAN');
      parent.push(photo);
    }
    const documents = rows.map((row) => mapMysqlCard(row, byCard.get(decimalId(row.id))));
    const seenTokens = new Set(); const seenMedia = new Set(); const seenStorage = new Set();
    for (const document of documents) {
      if (seenTokens.has(document.share_token)) throw new ImportError('IMPORT_CONFLICT');
      seenTokens.add(document.share_token);
      for (const photo of document.media) {
        if (seenMedia.has(photo.media_id) || seenStorage.has(photo.storage_key)) throw new ImportError('IMPORT_CONFLICT');
        seenMedia.add(photo.media_id); seenStorage.add(photo.storage_key);
      }
    }
    const pending = []; const resumeDocuments = [];
    for (const document of documents) {
      const matching = await inspectCardConflict(cards, document);
      const inPrefix = originalCheckpoint.last_id !== null && BigInt(document.legacy_mysql_id) <= BigInt(originalCheckpoint.last_id);
      if (inPrefix && !matching) throw new ImportError('IMPORT_CHECKPOINT');
      if (inPrefix) { prefixCards += 1; prefixMedia += document.media.length; }
      else { resumeDocuments.push(document); if (!matching) pending.push(document); }
      counts.cards += 1; counts.media += document.media.length;
      if (matching) counts.matching += 1;
    }
    if (apply && resumeDocuments.length) {
      // A failed ordered batch can leave committed cards. Its checkpoint stays
      // put; retry verifies those exact cards and inserts only the remainder.
      if (pending.length) await cards.insertMany(pending, { ordered: true, writeConcern: { w: 'majority' } });
      await acknowledgeBatch(checkpoints, checkpoint, resumeDocuments, { apply });
      counts.inserted += pending.length;
    }
    lastId = ids.at(-1);
  }
  if (counts.cards !== expected.cards || counts.media !== expected.media
    || prefixCards !== originalCheckpoint.card_count || prefixMedia !== originalCheckpoint.media_count) throw new ImportError('IMPORT_PARITY');
  if (apply) {
    if (checkpoint.card_count !== counts.cards || checkpoint.media_count !== counts.media
      || await cards.countDocuments({}, { maxTimeMS: 5000 }) !== counts.cards) throw new ImportError('IMPORT_PARITY');
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
  let sourceConnection; let targetClient;
  try {
    const settings = readImportSettings(env, args);
    if (settings.sourceCaFile) {
      if (!settings.source.ssl) throw new ImportError('IMPORT_TLS');
      settings.source.ssl.ca = await readFile(settings.sourceCaFile);
    }
    const { uri, databaseName, queueLimit: _queueLimit, operationTimeoutMS: _operationTimeoutMS, ...options } = settings.target;
    targetClient = new MongoClient(uri, { ...options, timeoutMS: 10000 });
    await targetClient.connect();
    const database = targetClient.db(databaseName);
    // Schema setup is separate. Dry-run never installs validation or indexes.
    if (settings.apply) await createDatabaseChecks(database).checkSchema();
    sourceConnection = await mysql.createConnection(settings.source);
    const counts = await importMysql({
      source: createMysqlSource(sourceConnection), database,
      sourceId: sourceFingerprint('mysql', { host: settings.source.host, port: settings.source.port, database: settings.source.database }),
      apply: settings.apply, emptyAcknowledged: settings.emptyAcknowledged,
    });
    console.log(`${settings.apply ? 'Import complete' : 'Dry-run complete'}: ${counts.cards} cards, ${counts.media} photos, ${counts.matching} matching cards, ${counts.inserted} inserted cards.`);
  } catch (error) {
    const { cards = 0, media = 0 } = error.importCounts ?? {};
    console.error(`Import stopped after validating ${cards} cards and ${media} photos. No source records were modified. Review compatibility, staging guards, backups, and conflicts before retrying.`);
    process.exitCode = 1;
  } finally {
    if (sourceConnection) {
      try { await sourceConnection.rollback(); } catch { /* Read-only source snapshot. */ }
      try { await sourceConnection.end(); } catch { process.exitCode = 1; }
    }
    try { await targetClient?.close(); } catch { process.exitCode = 1; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  await main();
}

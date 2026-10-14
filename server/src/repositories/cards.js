import { ObjectId } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { createDatabaseAdmission } from '../database-admission.js';
import { createDatabaseChecks } from '../database-checks.js';
import { isShareToken } from '../validation/cards.js';
import { activeCardFilter, tokenCollation, publicCardProjection, protectionProjection } from '../card-queries.js';

function uncertainWrite(cause) {
  const error = new Error('The card save could not be confirmed.', { cause });
  error.code = 'DATABASE_WRITE_UNCERTAIN';
  error.safeToCleanupPhotos = false;
  return error;
}

function definiteFailure(cause, tokenCollision = false) {
  const error = new Error('The card could not be saved.', { cause });
  error.code = tokenCollision ? 'ER_DUP_ENTRY' : 'DATABASE_WRITE_REJECTED';
  error.safeToCleanupPhotos = true;
  return error;
}

// Keep the six existing repository methods and row shapes. Photo metadata is
// embedded, so a card and all its metadata are saved with one atomic insert.
export function createCardsRepository(database, _client, {
  now = () => new Date(), makeId = () => new ObjectId(),
  operationTimeoutMS = 3000, runOperation, assertSchemaReady,
  onUncertainWrite = () => {},
} = {}) {
  const cards = database.collection('cards');
  const run = runOperation ?? createDatabaseAdmission({ operationTimeoutMS }).runDatabaseOperation;
  const checkSchema = assertSchemaReady ?? createDatabaseChecks(database, { runOperation: run, operationTimeoutMS }).checkSchema;
  let readyUntil = 0;
  let checkingSchema;
  async function assertWritable() {
    if (Date.now() < readyUntil) return;
    if (!checkingSchema) checkingSchema = Promise.resolve().then(checkSchema).then(() => {
      readyUntil = Date.now() + 5000;
    }).finally(() => { checkingSchema = undefined; });
    await checkingSchema;
  }
  const options = (scope) => ({ timeoutMS: scope.remainingMS(), collation: tokenCollation });
  const readOptions = (scope, projection) => ({ ...options(scope), projection, readConcern: { level: 'majority' } });

  async function reconcile(document, error, scope) {
    // A network/write-concern failure can happen after a successful insert.
    // Re-read the same private ID; never regenerate a token for an unknown save.
    try {
      const saved = await cards.findOne({ _id: document._id }, readOptions(scope));
      if (saved && isDeepStrictEqual(saved, document)) return true;
      if (saved) throw uncertainWrite(error);
      if (error?.hasErrorLabel?.('NoWritesPerformed')) throw definiteFailure(error,
        error.code === 11000 && Object.keys(error.keyPattern ?? {}).length === 1 && error.keyPattern.share_token === 1);
      if (error?.code === 11000) {
        const field = Object.keys(error.keyPattern ?? {})[0];
        if (field === 'share_token' || field === 'media.media_id' || field === 'media.storage_key') {
          const value = error.keyValue?.[field];
          if (typeof value === 'string') {
            const owner = await cards.findOne({ [field]: value, _id: { $ne: document._id } }, readOptions(scope, { _id: 1 }));
            if (owner && String(owner._id) !== String(document._id)) throw definiteFailure(error, field === 'share_token');
          }
        }
      }
    } catch (failure) {
      if (failure?.safeToCleanupPhotos === true) throw failure;
    }
    throw uncertainWrite(error);
  }

  return {
    assertWritable,
    async insert(card, shareToken, photos = []) {
      // Unlike SQL INSERT, MongoDB can create a missing collection implicitly.
      // Refuse writes without the expected validator/indexes; no auto-setup here.
      try { await assertWritable(); }
      catch (error) { throw definiteFailure(error); }
      const timestamp = now();
      const document = {
        _id: makeId(), schema_version: 1, share_token: shareToken,
        occasion: card.occasion, title: card.title ?? null, message: card.message,
        recipient_name: card.recipientName ?? null, theme: card.theme,
        customization: card.customization ?? null,
        unlock_code_hash: card.codeHash ?? null, unlock_hints: card.codeHash ? card.hints : null,
        status: 'active', created_at: timestamp, updated_at: timestamp, expires_at: null,
        media: photos.map((photo) => ({
          media_id: photo.mediaId, storage_key: photo.storageKey, mime_type: photo.mimeType,
          size_bytes: photo.size, width: photo.width, height: photo.height,
          sort_order: photo.sortOrder, created_at: timestamp,
        })),
      };
      try {
        await run(async (scope) => {
          try { await cards.insertOne(document, { timeoutMS: scope.remainingMS(), writeConcern: { w: 'majority', j: true } }); }
          catch (error) { await reconcile(document, error, scope); }
        });
      } catch (error) {
        if (error?.safeToCleanupPhotos === false) {
          try { onUncertainWrite(); } catch { /* Diagnostics must not replace the safe response. */ }
        }
        throw error;
      }
    },

    async findProtectionByToken(shareToken) {
      if (!isShareToken(shareToken)) return null;
      return run(async (scope) => await cards.findOne(activeCardFilter(shareToken), readOptions(scope, protectionProjection)) ?? null);
    },

    async findContentByToken(shareToken) {
      if (!isShareToken(shareToken)) return null;
      return run(async (scope) => await cards.findOne(activeCardFilter(shareToken), readOptions(scope, publicCardProjection)) ?? null);
    },

    async findPublicByToken(shareToken) {
      if (!isShareToken(shareToken)) return null;
      return run(async (scope) => await cards.findOne({ ...activeCardFilter(shareToken),
        unlock_code_hash: { $type: 'null' },
      }, readOptions(scope, publicCardProjection)) ?? null);
    },

    async listMediaByToken(shareToken) {
      if (!isShareToken(shareToken)) return [];
      return run(async (scope) => cards.aggregate([
        { $match: activeCardFilter(shareToken) }, { $unwind: '$media' },
        { $sort: { 'media.sort_order': 1, 'media.media_id': 1 } },
        { $project: { _id: 0, media_id: '$media.media_id', width: '$media.width', height: '$media.height' } },
      ], { ...options(scope), maxTimeMS: scope.remainingMS(), readConcern: { level: 'majority' } }).toArray());
    },

    async findMediaByToken(shareToken, mediaId) {
      if (!isShareToken(shareToken) || !isShareToken(mediaId)) return null;
      return run(async (scope) => await cards.aggregate([
        { $match: activeCardFilter(shareToken) }, { $unwind: '$media' },
        { $match: { 'media.media_id': mediaId } },
        { $project: { _id: 0, storage_key: '$media.storage_key', mime_type: '$media.mime_type' } },
        { $limit: 1 },
      ], { ...options(scope), maxTimeMS: scope.remainingMS(), readConcern: { level: 'majority' } }).next() ?? null);
    },
  };
}

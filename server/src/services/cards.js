import { randomBytes } from 'node:crypto';
import { isShareToken, publicCardFromRow, publicHintsFromRow } from '../validation/cards.js';
import { hashSecretCode, verifySecretCode } from '../security/secret-codes.js';
import { cleanupPhotos, preparePhotos } from '../media/photos.js';
import { PHOTO_LIMITS } from '../../../shared/mediaOptions.js';

export function createCardsService(repository, {
  generateShareToken = () => randomBytes(24).toString('base64url'), mediaStorage, mediaGrants,
} = {}) {
  const isProtected = (protection) => protection.unlock_code_hash !== null && protection.unlock_code_hash !== undefined;

  async function publicContent(shareToken, protection) {
    const row = await (isProtected(protection)
      ? repository.findContentByToken(shareToken)
      : repository.findPublicByToken(shareToken));
    const card = row ? publicCardFromRow(row) : null;
    if (!card) return null;
    // Older mock repositories and cards with no photos retain the old response.
    const photos = repository.listMediaByToken ? await repository.listMediaByToken(shareToken) : [];
    const safePhotos = photos.filter((photo) => isShareToken(photo.media_id)
      && Number.isInteger(photo.width) && photo.width > 0
      && Number.isInteger(photo.height) && photo.height > 0).slice(0, PHOTO_LIMITS.maxFiles)
      .map((photo) => ({
        id: photo.media_id,
        url: `/api/cards/${shareToken}/media/${photo.media_id}`,
        width: photo.width,
        height: photo.height,
      }));
    if (safePhotos.length) card.photos = safePhotos;
    return { card };
  }

  return {
    async create(card, files = []) {
      // Check persistence before expensive hashing or writing private files.
      await repository.assertWritable?.();
      // The plaintext code exists only for this request. The repository receives
      // the hash, never the protection object or its plaintext code.
      const codeHash = card.protection?.enabled ? await hashSecretCode(card.protection.code) : null;
      const storedCard = {
        occasion: card.occasion,
        title: card.title,
        recipientName: card.recipientName,
        message: card.message,
        theme: card.theme,
        customization: card.customization,
        codeHash,
        hints: codeHash ? card.protection.hints : [],
      };
      // Validate image content before writing, then remove prepared photos if
      // the database cannot commit the corresponding card and metadata.
      const photos = files.length ? await preparePhotos(files, mediaStorage) : [];
      try {
        // The database's unique key is the final authority if tokens collide.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const shareToken = generateShareToken();
          try {
            await repository.insert(storedCard, shareToken, photos);
            return { shareToken, cardPath: `/card/${shareToken}` };
          } catch (error) {
            if (error?.code !== 'ER_DUP_ENTRY' || attempt === 2) throw error;
          }
        }
      } catch (error) {
        // Unconfirmed writes may already be committed. Retain their files for
        // reconciliation instead of breaking a card that was actually saved.
        if (photos.length && error?.safeToCleanupPhotos !== false) await cleanupPhotos(photos, mediaStorage);
        throw error;
      }
    },

    async findPublic(shareToken, grant) {
      const protection = await repository.findProtectionByToken(shareToken);
      if (!protection) return null;
      if (isProtected(protection) && !mediaGrants?.allows(grant, shareToken, protection.unlock_code_hash)) {
        return { protection: { enabled: true, hints: publicHintsFromRow(protection.unlock_hints) } };
      }
      return publicContent(shareToken, protection);
    },

    async unlock(shareToken, code, { onAuthorized } = {}) {
      const protection = await repository.findProtectionByToken(shareToken);
      if (!protection) return null;
      if (isProtected(protection) && !await verifySecretCode(code, protection.unlock_code_hash)) return null;
      const result = await publicContent(shareToken, protection);
      if (result && isProtected(protection)) onAuthorized?.(protection.unlock_code_hash);
      return result;
    },

    async readPhoto(shareToken, mediaId, grant) {
      const protection = await repository.findProtectionByToken(shareToken);
      if (!protection || (isProtected(protection)
        && !mediaGrants?.allows(grant, shareToken, protection.unlock_code_hash))) return null;
      // Resolve the photo through its parent card before touching private files.
      const photo = await repository.findMediaByToken(shareToken, mediaId);
      if (!photo || photo.mime_type !== 'image/webp'
        || typeof photo.storage_key !== 'string' || photo.storage_key.length !== 37
        || !/^[A-Za-z0-9_-]{32}\.webp$/.test(photo.storage_key)) return null;
      try {
        return await mediaStorage.read(photo.storage_key);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}

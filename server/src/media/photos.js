import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { PHOTO_LIMITS } from '../../../shared/mediaOptions.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const allowedFormats = new Set(['jpeg', 'png', 'webp']);

function photoError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.isPhotoError = true;
  return error;
}

// Check actual bytes before asking the image decoder to open them. A filename
// such as "picture.jpg" and a browser's MIME type are not proof of its format.
function inputFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return 'jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function hasAnimation(buffer, format) {
  // Some image decoders treat animated PNGs as their first static frame. Reject
  // the animation marker explicitly, rather than accidentally accepting one.
  if (format === 'png') {
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (offset + length + 12 > buffer.length) return false; // Decoder rejects truncation.
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
      offset += length + 12;
    }
  }
  if (format === 'webp') {
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const length = buffer.readUInt32LE(offset + 4);
      if (offset + length + 8 > buffer.length) return false;
      const chunk = buffer.toString('ascii', offset, offset + 4);
      if (chunk === 'ANIM' || chunk === 'ANMF') return true;
      if (chunk === 'VP8X' && length > 0 && (buffer[offset + 8] & 2)) return true;
      offset += 8 + length + (length % 2);
    }
  }
  return false;
}

async function normalizePhoto(file, sortOrder) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw photoError(400, 'Choose a valid JPEG, PNG, or WebP photo.');
  }
  if (file.buffer.length > PHOTO_LIMITS.maxBytes) {
    throw photoError(413, 'Each photo must be 5 MiB or smaller.');
  }
  const format = inputFormat(file.buffer);
  if (!format) throw photoError(400, 'Photos must be JPEG, PNG, or WebP images.');
  if (hasAnimation(file.buffer, format)) {
    throw photoError(400, 'Animated images are not supported. Choose a still photo.');
  }

  let output;
  try {
    const image = sharp(file.buffer, {
      failOn: 'warning',
      limitInputPixels: PHOTO_LIMITS.maxPixels,
      limitInputChannels: 4,
    });
    const metadata = await image.metadata();
    if (!allowedFormats.has(metadata.format) || metadata.format !== format) {
      throw photoError(400, 'Photos must be JPEG, PNG, or WebP images.');
    }
    if ((metadata.pages ?? 1) !== 1 || metadata.loop !== undefined || metadata.delay?.length) {
      throw photoError(400, 'Animated images are not supported. Choose a still photo.');
    }
    const { width, height } = metadata;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > PHOTO_LIMITS.maxDimension || height > PHOTO_LIMITS.maxDimension
      || width * height > PHOTO_LIMITS.maxPixels) {
      throw photoError(400, 'Choose a photo up to 12 megapixels and 8192 pixels per side.');
    }

    // rotate() applies camera orientation. Re-encoding strips location, EXIF,
    // and other original metadata by default, and gives storage one safe format.
    output = await image.rotate().resize({
      width: PHOTO_LIMITS.maxOutputDimension,
      height: PHOTO_LIMITS.maxOutputDimension,
      fit: 'inside',
      withoutEnlargement: true,
    }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error.isPhotoError) throw error;
    throw photoError(400, 'This photo could not be read. Choose a complete JPEG, PNG, or WebP image.');
  }

  const mediaId = randomBytes(24).toString('base64url');
  return {
    buffer: output.data,
    metadata: {
      mediaId,
      storageKey: `${mediaId}.webp`,
      mimeType: 'image/webp',
      size: output.data.length,
      width: output.info.width,
      height: output.info.height,
      sortOrder,
    },
  };
}

// Best-effort cleanup is also used when a later database insert fails. A
// cleanup problem must not replace the original safe response to the sender.
export async function cleanupPhotos(photos, storage) {
  await Promise.allSettled(photos.map(async photo => storage.remove(photo.storageKey)));
}

export async function preparePhotos(files = [], storage) {
  if (!Array.isArray(files) || files.length > PHOTO_LIMITS.maxFiles) {
    throw photoError(400, 'You can add up to 4 photos.');
  }

  // Decode every file before writing any of them. One invalid photo leaves no
  // files behind. Sequential work keeps memory use predictable for beginners.
  const prepared = [];
  for (const [sortOrder, file] of files.entries()) {
    prepared.push(await normalizePhoto(file, sortOrder));
  }

  const saved = [];
  try {
    for (const photo of prepared) {
      await storage.write(photo.metadata.storageKey, photo.buffer);
      saved.push(photo.metadata);
    }
    return saved;
  } catch {
    await cleanupPhotos(saved, storage);
    throw photoError(503, 'Photos could not be saved right now. Please try again.');
  }
}

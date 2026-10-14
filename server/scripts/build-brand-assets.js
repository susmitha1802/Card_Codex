import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Render only the checked-in brand artwork, never recipient content or photos.
const source = fileURLToPath(new URL('../../client/brand/share-preview.svg', import.meta.url));
const output = fileURLToPath(new URL('../../client/public/share-preview.png', import.meta.url));
await sharp(source).png().toFile(output);
console.log('Emotale social-preview image generated (1200 × 630).');

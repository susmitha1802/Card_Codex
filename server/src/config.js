import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config-reader.js';

// Use a fixed file path so commands work from the root or server folder.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});

export { readConfig, validatePublicAppOrigin, ConfigurationError } from './config-reader.js';
export const config = readConfig(process.env);

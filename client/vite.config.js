import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sharePreviewPlugin } from './server/sharePreviewPlugin.js';
import { readFrontendSettings } from '../server/src/frontend-settings.js';

export default defineConfig(() => {
  const { apiTarget, publicOrigin } = readFrontendSettings();
  const apiProxy = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
    },
  };

  return {
    // Disable automatic client .env loading. The helper above never puts
    // server configuration into import.meta.env or define.
    envDir: false,
    plugins: [react(), tailwindcss(), sharePreviewPlugin({ apiTarget, publicOrigin })],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      proxy: apiProxy,
    },
  };
});

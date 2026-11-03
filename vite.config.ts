import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// `pnpm dev:phone` serves over HTTPS: phones block the camera on plain http.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'phone' ? [basicSsl()] : [])],
  // three.js alone is close to 700 kB.
  build: { chunkSizeWarningLimit: 900 },
}));

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // three.js alone is close to 700 kB.
  build: { chunkSizeWarningLimit: 900 },
});
